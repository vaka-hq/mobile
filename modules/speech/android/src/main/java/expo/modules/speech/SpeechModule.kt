package expo.modules.speech

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.nio.ByteOrder
import java.util.zip.ZipInputStream
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer

/** The rate Vosk's small models are trained at. */
private const val speechRate = 16000

/** The longest stretch transcribed at once, in seconds, so a call stays short. */
private const val longestSnippet = 120.0

/** How long the model stays in memory after it was last used, in ms. */
private const val modelIdleMillis = 60_000L

class SnippetRequest : Record {
  /** An http(s) URL to stream from, or a file URI or path on the phone. */
  @Field val source: String = ""
  @Field val headers: Map<String, String> = emptyMap()
  /** Where the stretch starts in the file, in seconds. */
  @Field val start: Double = 0.0
  /** How long it is, in seconds. */
  @Field val duration: Double = 20.0
  /** The unpacked model's directory. */
  @Field val model: String = ""
}

class ModelError(message: String) : CodedException("ERR_SPEECH_MODEL", message, null)

class AudioError(message: String) : CodedException("ERR_SPEECH_AUDIO", message, null)

/**
 * Turns a short stretch of an audiobook into words, offline, to find where listening and reading
 * meet. The audio is read from the file or stream directly, never from the microphone, and only
 * the stretch asked for is fetched and decoded.
 */
class SpeechModule : Module() {
  private var loaded: Pair<String, Model>? = null

  override fun definition() = ModuleDefinition {
    Name("Speech")

    // Unpacks a downloaded model archive into `directory`, dropping the archive's top folder, and
    // only then moves it into place, so a half-unpacked model is never used.
    AsyncFunction("installModel") { archive: String, directory: String ->
      val target = File(pathOf(directory))
      val partial = File(target.parentFile, "${target.name}.part")
      partial.deleteRecursively()
      partial.mkdirs()
      val root = partial.canonicalPath + File.separator

      ZipInputStream(File(pathOf(archive)).inputStream().buffered()).use { zip ->
        while (true) {
          val entry = zip.nextEntry ?: break
          val name = entry.name.substringAfter('/', "")
          if (name.isEmpty()) continue
          val file = File(partial, name)
          // Never write outside the model's folder, whatever the archive names.
          if (!file.canonicalPath.startsWith(root)) throw ModelError("The model archive is not valid")
          if (entry.isDirectory) {
            file.mkdirs()
          } else {
            file.parentFile?.mkdirs()
            file.outputStream().use { zip.copyTo(it) }
          }
        }
      }

      if (!File(partial, "am").exists() && !File(partial, "conf").exists()) {
        partial.deleteRecursively()
        throw ModelError("The archive holds no speech model")
      }

      releaseModel()
      target.deleteRecursively()
      if (!partial.renameTo(target)) throw ModelError("The model could not be put in place")
    }

    // The words spoken in a stretch of the audio, each with when it starts and ends in the file.
    // The audio goes to the recognizer as it is decoded, a little at a time, so memory stays the
    // same however long the stretch.
    AsyncFunction("transcribe") { request: SnippetRequest ->
      val duration = request.duration.coerceIn(1.0, longestSnippet)
      val words = mutableListOf<Map<String, Any>>()

      withModel(pathOf(request.model)) { model ->
        Recognizer(model, speechRate.toFloat()).use { recognizer ->
          recognizer.setWords(true)
          fun collect(json: String) {
            val result = JSONObject(json).optJSONArray("result") ?: return
            for (index in 0 until result.length()) {
              val word = result.getJSONObject(index)
              words.add(
                mapOf(
                  "word" to word.getString("word"),
                  "start" to request.start + word.getDouble("start"),
                  "end" to request.start + word.getDouble("end"),
                )
              )
            }
          }

          decode(request.source, request.headers, request.start, duration) { samples, size ->
            if (recognizer.acceptWaveForm(samples, size)) collect(recognizer.result)
          }
          collect(recognizer.finalResult)
        }
      }

      mapOf("words" to words)
    }

    // Lets go of the model in memory, such as when it is deleted.
    Function("releaseModel") { releaseModel() }

    OnDestroy { releaseModel() }
  }

  private fun pathOf(uri: String) = if (uri.startsWith("file:")) Uri.parse(uri).path ?: uri else uri

  private val main = Handler(Looper.getMainLooper())
  private var users = 0
  /** Asked to let go of the model while a stretch was being heard; done once it is finished. */
  private var releaseWhenDone = false
  private val idleRelease: Runnable = Runnable {
    synchronized(this@SpeechModule) { if (users == 0) releaseModel() }
  }

  /**
   * Runs `block` with the model loaded. Loading takes a moment, so the model stays in memory for a
   * minute after its last use, for the next stretch of the same search, and is then let go.
   */
  private fun <T> withModel(path: String, block: (Model) -> T): T {
    val model = synchronized(this) {
      main.removeCallbacks(idleRelease)
      releaseWhenDone = false
      users++
      try {
        modelAt(path)
      } catch (error: Throwable) {
        users--
        throw error
      }
    }
    try {
      return block(model)
    } finally {
      synchronized(this) {
        users--
        if (users == 0) {
          if (releaseWhenDone) releaseModel() else main.postDelayed(idleRelease, modelIdleMillis)
        }
      }
    }
  }

  /** Frees the model, or while a stretch is being heard with it, as soon as that is done. */
  private fun releaseModel(): Unit = synchronized(this) {
    main.removeCallbacks(idleRelease)
    if (users > 0) {
      releaseWhenDone = true
      return
    }
    releaseWhenDone = false
    loaded?.second?.close()
    loaded = null
  }

  private fun modelAt(path: String): Model {
    loaded?.takeIf { it.first == path }?.let { return it.second }
    if (!File(path).isDirectory) throw ModelError("The speech model is not installed")
    LibVosk.setLogLevel(LogLevel.WARNINGS)
    loaded?.second?.close()
    loaded = null
    val model = try {
      Model(path)
    } catch (error: Exception) {
      throw ModelError("The speech model could not be loaded")
    }
    loaded = path to model
    return model
  }

  /**
   * Decodes `duration` seconds from `start`, mono at the model's rate, handing it to `sink` in
   * short chunks as it goes. The file is read from the nearest point it can seek to before `start`;
   * what comes before `start` is decoded and dropped.
   */
  private fun decode(
    source: String,
    headers: Map<String, String>,
    start: Double,
    duration: Double,
    sink: (ShortArray, Int) -> Unit
  ) {
    val extractor = MediaExtractor()
    try {
      if (source.startsWith("http://") || source.startsWith("https://")) {
        extractor.setDataSource(source, headers)
      } else {
        extractor.setDataSource(pathOf(source))
      }
    } catch (error: Exception) {
      extractor.release()
      throw AudioError("The audio could not be opened")
    }

    try {
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw AudioError("The file has no audio")
      val format = extractor.getTrackFormat(track)
      val mime = format.getString(MediaFormat.KEY_MIME) ?: throw AudioError("The audio has no type")
      extractor.selectTrack(track)

      val startUs = (start * 1_000_000).toLong().coerceAtLeast(0)
      val endUs = startUs + (duration * 1_000_000).toLong()
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

      val codec = MediaCodec.createDecoderByType(mime)
      codec.configure(format, null, null, 0)
      codec.start()

      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var float = false
      var resampler: Resampler? = null
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      var outputDone = false

      try {
        while (!outputDone) {
          if (!inputDone) {
            val inputIndex = codec.dequeueInputBuffer(10_000)
            if (inputIndex >= 0) {
              val buffer = codec.getInputBuffer(inputIndex)!!
              val size = extractor.readSampleData(buffer, 0)
              if (size < 0 || extractor.sampleTime > endUs) {
                codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }

          val outputIndex = codec.dequeueOutputBuffer(info, 10_000)
          when {
            outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              val output = codec.outputFormat
              rate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE)
              channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              float = output.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                output.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
              resampler?.flush()
              resampler = null
            }
            outputIndex >= 0 -> {
              val out = resampler ?: Resampler(rate, sink).also { resampler = it }
              val buffer = codec.getOutputBuffer(outputIndex)!!.order(ByteOrder.nativeOrder())
              buffer.position(info.offset)
              buffer.limit(info.offset + info.size)
              val frames = if (float) info.size / 4 / channels else info.size / 2 / channels
              for (frame in 0 until frames) {
                val time = info.presentationTimeUs + frame * 1_000_000L / rate
                var sum = 0f
                for (channel in 0 until channels) {
                  sum += if (float) buffer.float else buffer.short / 32768f
                }
                if (time in startUs until endUs) out.add(sum / channels)
              }
              codec.releaseOutputBuffer(outputIndex, false)
              if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0 || info.presentationTimeUs > endUs) {
                outputDone = true
              }
            }
          }
        }
        resampler?.flush()
      } finally {
        codec.stop()
        codec.release()
      }
    } finally {
      extractor.release()
    }
  }
}

/**
 * Turns mono samples at `rate` into 16-bit samples at the model's rate as they arrive, by linear
 * interpolation, and hands them on a fixed-size chunk at a time.
 */
private class Resampler(rate: Int, private val sink: (ShortArray, Int) -> Unit) {
  private val step = rate.toDouble() / speechRate
  private val chunk = ShortArray(4000)
  private var count = 0
  private var index = -1L
  private var previous = 0f
  private var next = 0.0

  fun add(sample: Float) {
    index++
    while (next <= index) {
      val mix = (next - (index - 1)).toFloat()
      val value = previous * (1 - mix) + sample * mix
      chunk[count++] = (value.coerceIn(-1f, 1f) * 32767).toInt().toShort()
      if (count == chunk.size) flush()
      next += step
    }
    previous = sample
  }

  fun flush() {
    if (count > 0) sink(chunk, count)
    count = 0
  }
}
