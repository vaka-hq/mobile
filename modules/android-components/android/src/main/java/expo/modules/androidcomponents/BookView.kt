package expo.modules.androidcomponents

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.ui.Alignment
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.delay
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.Spring
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.ActionMode
import android.view.HapticFeedbackConstants
import android.view.Menu
import android.view.MenuItem
import androidx.compose.foundation.magnifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import expo.modules.kotlin.views.AsyncFunctionHandle
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import java.io.File
import java.text.BreakIterator
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.hypot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@OptimizedComposeProps
data class BookViewProps(val unused: Boolean = false) : ComposeProps

@OptimizedRecord
data class BookMessage(
  @Field val data: String
) : Record

/** A highlight the app keeps, as the page draws it. */
private class Mark(val range: BookRange, val color: String)

private val highlightFills = mapOf(
  "yellow" to Color(0xFFFFD54F),
  "green" to Color(0xFF81C784),
  "blue" to Color(0xFF64B5F6),
  "pink" to Color(0xFFF06292)
)

/** Cards the row passes in a sweep across the whole slider, and how quickly it follows, per second. */
private const val sweepCards = 30f
private const val glideRate = 30f

/** Where a sentence ends: its closing mark, any closing quote or bracket, then a space. */
private val sentenceEnd = Regex("[.!?…][\"”’)\\]]*\\s")

/**
 * The sentence around a place in its block, to its closing mark; with `fromHere`, from the place
 * itself, such as the top of a page, so nothing before it is marked.
 */
private fun sentenceAround(book: EpubBook, pos: BookPos, fromHere: Boolean): BookRange? {
  val text = (book.chapters.getOrNull(pos.chapter)?.blocks?.getOrNull(pos.block) as? TextBlock)?.text ?: return null
  if (text.isBlank()) return null
  val at = pos.offset.coerceIn(0, maxOf(0, text.length - 1))
  var start = 0
  var end = text.length
  for (match in sentenceEnd.findAll(text)) {
    if (match.range.last <= at) {
      start = match.range.last + 1
    } else {
      end = match.range.last
      break
    }
  }
  if (fromHere) start = maxOf(start, pos.offset.coerceIn(0, text.length))
  if (start >= end) return null
  return BookRange(BookPos(pos.chapter, pos.block, start), BookPos(pos.chapter, pos.block, end))
}

/** How much text a search result shows before and after the match, at most, in characters. */
private const val excerptBefore = 140
private const val excerptAfter = 260

/** Characters read in a minute, for the time left in a chapter. */
private const val charsPerMinute = 1400f

/** Where a page sits among the pages of its chapter. */
private data class PageRef(val chapter: Int, val index: Int)

/** A point on the page matched to the text under it. */
private class Hit(val chapter: Int, val block: Int, val offset: Int)

/**
 * The reader's state outside composition: the book, how it is laid out, where the reader is, and
 * the marks and selection drawn over the text. Chapters are laid out one at a time on a single
 * background thread, the one the reader is in first.
 */
@OptIn(ExperimentalCoroutinesApi::class)
/**
 * What the page's actions are called, in the reader's language, sent from JS: those TalkBack
 * offers, and those of the toolbar over selected text.
 */
private data class ReaderLabels(
  val showControls: String = "Show reader controls",
  val nextPage: String = "Next page",
  val previousPage: String = "Previous page",
  val highlight: String = "Highlight",
  val note: String = "Note",
  val copy: String = "Copy",
  val share: String = "Share",
)

private class BookState(val scope: CoroutineScope, val post: (JSONObject) -> Unit) {
  var labels by mutableStateOf(ReaderLabels())
  var book by mutableStateOf<EpubBook?>(null)
  var style by mutableStateOf<BookStyle?>(null)
  var layout by mutableStateOf<BookLayout?>(null)
  val chapters = mutableStateMapOf<Int, ChapterPages>()
  val pageCounts = mutableStateMapOf<Int, Int>()
  /** The place being read: the start of the page showing, kept across relayouts. */
  var anchor by mutableStateOf(BookPos(0, 0, 0))
  var page by mutableStateOf<PageRef?>(null)
  var selection by mutableStateOf<BookRange?>(null)
  /** A finger is making or moving the selection; its toolbar waits until it lifts. */
  var selecting by mutableStateOf(false)
  var overview by mutableStateOf(false)
  var card by mutableStateOf<OverviewCard?>(null)
  val marks = mutableStateMapOf<String, Mark>()
  var bookmarks by mutableStateOf<List<BookPos>>(emptyList())
  var searchHits by mutableStateOf<List<BookRange>>(emptyList())
  /**
   * Where the reader picks up, tinted so the eye finds it: as the book opens, the sentence at the
   * top of the page reading stopped on, from there on only; after moving to where the book was
   * listened to, the sentence heard last. It stays while the book is open; the next visit marks
   * the reading place as it is then.
   */
  var placeMark by mutableStateOf<BookRange?>(null)

  fun markPlace(pos: BookPos, fromHere: Boolean) {
    val book = book ?: return
    placeMark = sentenceAround(book, pos, fromHere)
  }
  /**
   * How far a pinch has carried the page into the overview, from 0 to 1, while fingers are down or
   * the page settles back; null otherwise. It drives the same zoom a tap animates.
   */
  var pinchProgress by mutableStateOf<Float?>(null)
  /** Set when a long press starts a selection, so the finger lifting is not also a tap. */
  var longPressed = false
  /** How much of the page the app covers from below, such as with its display panel, in dp. */
  var coveredBelow by mutableStateOf(0f)
  var tocPositions: List<Pair<BookPos, TocEntry>> = emptyList()
  /** Every chapter is counted and the page being read is laid out: the book can be shown. */
  var ready by mutableStateOf(false)
  /** The book's file name, part of the key its page counts are kept under. */
  var source = ""
  var cacheDir: File? = null
  /** Which way the overview's row moves when the book is moved from outside it, 0 for none. */
  var pendingSlide = 0
  /**
   * While the overview's slider is dragged, the page under it, counted across the whole book and
   * with a fraction for how far towards the next; the row of cards follows it continuously.
   */
  var scrub by mutableStateOf<Float?>(null)
  /** The last page a scrub reported, so the app hears of each page once. */
  private var scrubReported = -1
  private val worker = Dispatchers.Default.limitedParallelism(1)
  /** Chapters being laid out, each with the layout it is laid out for. */
  private val pending = mutableMapOf<Int, BookLayout>()
  /** What waits on a chapter being laid out, such as showing a page in it. */
  private val waiters = java.util.concurrent.ConcurrentHashMap<Int, MutableList<() -> Unit>>()
  private var searchJob: Job? = null
  /** Where the page counts of the book in its current settings are kept, once counted. */
  var countKey: String? = null

  /** Decoded images, kept to an eighth of the app's memory by their size in bytes. */
  val images = object : LruCache<String, ImageBitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
    override fun sizeOf(key: String, value: ImageBitmap) = value.asAndroidBitmap().byteCount
  }

  val totalPages: Int get() = book?.chapters?.indices?.sumOf { pageCounts[it] ?: 0 } ?: 0

  /** A page's number across the whole book, from 0. */
  fun globalOf(ref: PageRef): Int = (0 until ref.chapter).sumOf { pageCounts[it] ?: 0 } + ref.index

  /** The page with this number across the whole book, laid out or not. */
  fun refOf(global: Int): PageRef? {
    val book = book ?: return null
    var left = global
    for (chapter in book.chapters.indices) {
      val count = pageCounts[chapter] ?: return null
      if (left < count) return PageRef(chapter, left)
      left -= count
    }
    return null
  }

  /** The chapters wanted laid out: beside the page being read and beside the one scrubbed to. */
  private fun wanted(chapter: Int): Boolean {
    val reading = page?.chapter
    val scrubbed = scrub?.let { refOf(it.roundToInt())?.chapter }
    return (reading != null && abs(chapter - reading) <= 1) || (scrubbed != null && abs(chapter - scrubbed) <= 1) ||
      (reading == null && scrubbed == null)
  }

  /** Moves the row of cards under the slider, and tells the app of each page it passes. */
  fun scrubTo(fraction: Float, settle: Boolean) {
    val total = totalPages
    val book = book ?: return
    if (total <= 0) {
      if (settle) show(book.posAt(fraction))
      return
    }
    val global = (fraction.coerceIn(0f, 1f) * (total - 1))
    val ref = refOf(global.roundToInt()) ?: return
    if (settle) {
      scrub = null
      scrubReported = -1
      pendingSlide = 0
      go(ref)
      return
    }
    // Nothing is laid out while the slider moves; the cards show a sketch of a page until it is
    // let go, and only then is the chapter it settled in laid out.
    scrub = global
    val number = global.roundToInt()
    if (number != scrubReported) {
      scrubReported = number
      relocateTo(ref)
    }
  }

  /** Shows a page by its place in the book, drawing it blank until its chapter is laid out. */
  fun go(ref: PageRef) {
    if (pageAt(ref) != null) {
      turned(ref)
    } else {
      page = ref
      selection = null
      ensure(ref.chapter) { turned(ref) }
    }
  }

  fun ensure(chapter: Int, onReady: (() -> Unit)? = null) {
    val book = book ?: return
    val layout = layout ?: return
    if (chapter !in book.chapters.indices) return
    if (chapters.containsKey(chapter)) {
      onReady?.invoke()
      return
    }
    // Every caller waiting on a chapter is answered once it is laid out, however many asked.
    if (onReady != null) waiters.getOrPut(chapter) { java.util.concurrent.CopyOnWriteArrayList() }.add(onReady)
    if (pending[chapter] === layout) return
    pending[chapter] = layout
    scope.launch {
      // A chapter the reader has already moved away from, such as one a quick scrub passed, is
      // not laid out; one someone waits on is. A chapter that cannot be laid out reads as one
      // empty page rather than leaving the reader waiting.
      val pages = withContext(worker) {
        when {
          this@BookState.layout !== layout -> null
          waiters[chapter].isNullOrEmpty() && !wanted(chapter) -> null
          else -> runCatching { layout.paginate(chapter) }
            .getOrElse { ChapterPages(chapter, listOf(BookPage(chapter, emptyList()))) }
        }
      }
      if (pending[chapter] === layout) pending.remove(chapter)
      if (pages != null && this@BookState.layout === layout) {
        chapters[chapter] = pages
        if (pageCounts[chapter] != pages.pages.size) {
          // A kept count that no longer matches is corrected where it is kept too.
          pageCounts[chapter] = pages.pages.size
          saveCounts()
        }
        evict(chapter)
        waiters.remove(chapter)?.forEach { it() }
      }
    }
  }

  /** Keeps the book's page counts in the cache, replacing the file whole. */
  private fun saveCounts() {
    val key = countKey ?: return
    val book = book ?: return
    if (!book.chapters.indices.all { pageCounts.containsKey(it) }) return
    val counts = IntArray(book.chapters.size) { pageCounts[it] ?: 1 }
    scope.launch(Dispatchers.IO) { writePageCounts(cacheDir, key, counts) }
  }

  /** Keeps the laid-out chapters near the one being read; the rest are laid out again as needed. */
  private fun evict(latest: Int) {
    val current = page?.chapter ?: latest
    val scrubbed = scrub?.let { refOf(it.roundToInt())?.chapter }
    chapters.keys
      .filter { abs(it - current) > 2 && it != latest && (scrubbed == null || abs(it - scrubbed) > 1) }
      .forEach { chapters.remove(it) }
  }

  fun relayout(next: BookLayout?) {
    layout = next
    chapters.clear()
    pageCounts.clear()
    pending.clear()
    waiters.clear()
    countKey = null
  }

  fun pagesOf(chapter: Int) = chapters[chapter]

  fun previous(ref: PageRef): PageRef? = when {
    ref.index > 0 -> PageRef(ref.chapter, ref.index - 1)
    ref.chapter > 0 -> pagesOf(ref.chapter - 1)?.let { PageRef(ref.chapter - 1, it.pages.size - 1) }
    else -> null
  }

  fun next(ref: PageRef): PageRef? {
    val pages = pagesOf(ref.chapter) ?: return null
    val book = book ?: return null
    return when {
      ref.index < pages.pages.size - 1 -> PageRef(ref.chapter, ref.index + 1)
      ref.chapter < book.chapters.size - 1 -> if (pagesOf(ref.chapter + 1) != null) PageRef(ref.chapter + 1, 0) else null
      else -> null
    }
  }

  fun pageAt(ref: PageRef?): BookPage? = ref?.let { pagesOf(it.chapter)?.pages?.getOrNull(it.index) }

  /** The bookmarks on a page: from where it starts to where the next one does. */
  fun bookmarksOn(ref: PageRef): List<BookPos> {
    val start = pageAt(ref)?.start ?: return emptyList()
    val end = next(ref)?.let { pageAt(it)?.start } ?: BookPos(ref.chapter + 1, 0, 0)
    return bookmarks.filter { it >= start && it < end }
  }

  /**
   * Bookmarks the page being read, or takes its bookmarks away: at once here, so its ribbon moves
   * as the finger lifts, and then in the app, which keeps them and sends them back the same.
   */
  fun toggleBookmarkHere() {
    val ref = page ?: return
    val start = pageAt(ref)?.start ?: return
    val existing = bookmarksOn(ref)
    val message = JSONObject().put("type", "bookmark")
    if (existing.isEmpty()) {
      bookmarks = bookmarks + start
      message.put("add", start.encode()).put("remove", JSONArray())
    } else {
      bookmarks = bookmarks - existing.toSet()
      message.put("add", JSONObject.NULL).put("remove", JSONArray(existing.map { it.encode() }))
    }
    post(message)
    relocate()
  }

  /** Shows the page a place is on, laying its chapter out first if needed. */
  fun show(requested: BookPos) {
    val book = book ?: return
    // A place outside the book, such as one kept from an older reading of it, opens at its start.
    val pos = if (requested.chapter in book.chapters.indices) requested else firstReadable(book)
    anchor = pos
    ensure(pos.chapter) {
      val pages = pagesOf(pos.chapter) ?: return@ensure
      page = PageRef(pos.chapter, pages.pageOf(pos))
      prefetch()
      relocate()
    }
  }

  /** Lays out the chapters either side of the one being read, so turning into them is instant. */
  fun prefetch() {
    val ref = page ?: return
    ensure(ref.chapter - 1)
    ensure(ref.chapter + 1)
  }

  fun turned(requested: PageRef) {
    // A page past its chapter's end, as a stale count can ask for, is its chapter's last page.
    val size = pagesOf(requested.chapter)?.pages?.size
    val to = if (size != null && requested.index >= size) PageRef(requested.chapter, size - 1) else requested
    page = to
    pageAt(to)?.let { anchor = it.start }
    clearSelection()
    prefetch()
    relocate()
  }

  /** Drops a selection and tells the app it is gone. */
  fun clearSelection() {
    if (selection != null) {
      selection = null
      postSelection()
    }
  }

  fun tocEntryAt(pos: BookPos): TocEntry? = tocPositions.lastOrNull { it.first <= pos }?.second

  /** Tells the app where the reader is, after every turn. */
  fun relocate() {
    val book = book ?: return
    val style = style ?: return
    val ref = page
    val start = pageAt(ref)?.start ?: anchor
    val chapter = book.chapters.getOrNull(start.chapter) ?: return
    val end = if (ref != null) {
      next(ref)?.let { pageAt(it)?.start } ?: BookPos(start.chapter + 1, 0, 0)
    } else {
      BookPos(start.chapter, start.block + 1, 0)
    }
    val bookmark = bookmarks.firstOrNull { it >= start && it < end }
    val charsLeft = chapter.length - chapter.charStart(start.block) - start.offset
    val bookLeft = book.totalChars - (book.fraction(start) * book.totalChars)
    val chapterPages = ref?.let { pagesOf(it.chapter)?.pages?.size }
    val entry = tocEntryAt(start)
    // Every chapter is counted before the book shows, so page numbers are exact.
    val counted = book.chapters.indices.all { pageCounts.containsKey(it) }
    val pageNumber = if (counted && ref != null) (0 until ref.chapter).sumOf { pageCounts[it] ?: 0 } + ref.index + 1 else null
    post(
      JSONObject()
        .put("type", "relocate")
        .put("location", start.encode())
        .put("pageStart", start.encode())
        .put("bookmark", bookmark?.encode() ?: JSONObject.NULL)
        .put("sectionPagesLeft", if (chapterPages != null && ref != null) maxOf(0, chapterPages - 1 - ref.index) else JSONObject.NULL)
        .put("fraction", book.fraction(start).toDouble())
        .put("tocLabel", entry?.label ?: JSONObject.NULL)
        .put("tocHref", entry?.href ?: JSONObject.NULL)
        .put("sectionMinutesLeft", (charsLeft / charsPerMinute).toDouble())
        .put("bookMinutesLeft", (bookLeft / charsPerMinute).toDouble())
        .put("page", pageNumber ?: JSONObject.NULL)
        .put("pages", if (counted) book.chapters.indices.sumOf { pageCounts[it] ?: 0 } else JSONObject.NULL)
        .put("passage", passageAt(book, start))
    )
  }

  /** Tells the app of a page the slider passes, whether or not its chapter is laid out yet. */
  fun relocateTo(ref: PageRef) {
    val book = book ?: return
    val start = pageAt(ref)?.start ?: BookPos(ref.chapter, 0, 0)
    val count = pageCounts[ref.chapter] ?: 1
    val entry = tocEntryAt(start) ?: tocPositions.lastOrNull { it.first.chapter <= ref.chapter }?.second
    val total = totalPages
    post(
      JSONObject()
        .put("type", "relocate")
        .put("location", start.encode())
        .put("pageStart", start.encode())
        .put("bookmark", JSONObject.NULL)
        .put("sectionPagesLeft", maxOf(0, count - 1 - ref.index))
        .put("fraction", if (total > 1) globalOf(ref).toDouble() / (total - 1) else 0.0)
        .put("tocLabel", entry?.label ?: JSONObject.NULL)
        .put("tocHref", entry?.href ?: JSONObject.NULL)
        .put("sectionMinutesLeft", JSONObject.NULL)
        .put("bookMinutesLeft", JSONObject.NULL)
        .put("page", globalOf(ref) + 1)
        .put("pages", total)
    )
  }

  /** A place from a locator of either reader, an anchor in the book or a mark. */
  fun positionOf(target: String): BookPos? {
    val book = book ?: return null
    marks[target]?.let { return it.range.start }
    BookPos.decode(target)?.let { return if (it.chapter in book.chapters.indices) it else null }
    return book.resolve(target)
  }

  /** Finds a highlight by its text, for one whose saved place the reader cannot read. */
  fun resolveByText(text: String): BookRange? {
    val book = book ?: return null
    val needle = text.trim().take(80)
    if (needle.isEmpty()) return null
    for (chapter in book.chapters.indices) {
      val blocks = book.chapters.getOrNull(chapter)?.blocks ?: continue
      blocks.forEachIndexed { index, block ->
        if (block is TextBlock) {
          val at = block.text.indexOf(needle)
          if (at >= 0) {
            val length = text.trim().length
            val endBlock = index
            val endOffset = minOf(block.text.length, at + length)
            return BookRange(BookPos(chapter, index, at), BookPos(chapter, endBlock, endOffset))
          }
        }
      }
    }
    return null
  }

  fun addMark(annotation: JSONObject) {
    val value = annotation.optString("value")
    val color = annotation.optString("color", "yellow")
    val text = annotation.optString("text").takeIf { it.isNotEmpty() }
    // A saved place is used while its text still matches; otherwise the text is found again.
    val decoded = BookRange.decode(value)?.takeIf { range ->
      range.start.chapter in (book?.chapters?.indices ?: IntRange.EMPTY) &&
        (text == null || textOf(range).trim().take(24) == text.trim().take(24))
    }
    val range = decoded ?: text?.let { resolveByText(it) } ?: return
    marks[value] = Mark(range, color)
  }

  fun textOf(range: BookRange): String {
    val chapter = book?.chapters?.getOrNull(range.start.chapter) ?: return ""
    val parts = mutableListOf<String>()
    for (index in range.start.block..range.end.block) {
      val block = chapter.blocks.getOrNull(index) as? TextBlock ?: continue
      val from = if (index == range.start.block) range.start.offset else 0
      val to = if (index == range.end.block) range.end.offset else block.text.length
      if (from < to) parts.add(block.text.substring(from.coerceIn(0, block.text.length), to.coerceIn(0, block.text.length)))
    }
    return parts.joinToString("\n")
  }

  fun postSelection() {
    val range = selection
    post(
      JSONObject()
        .put("type", "selection")
        .put("text", range?.let { textOf(it).trim() }?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
        .put("location", range?.encode() ?: JSONObject.NULL)
    )
  }

  fun search(query: String) {
    searchJob?.cancel()
    val book = book ?: return
    searchHits = emptyList()
    searchJob = scope.launch {
      val hits = mutableListOf<BookRange>()
      withContext(Dispatchers.Default) {
        outer@ for ((chapterIndex, chapter) in book.chapters.withIndex()) {
          for ((blockIndex, block) in chapter.blocks.withIndex()) {
            if (block !is TextBlock) continue
            var from = 0
            while (true) {
              val at = block.text.indexOf(query, from, ignoreCase = true)
              if (at < 0) break
              hits.add(BookRange(BookPos(chapterIndex, blockIndex, at), BookPos(chapterIndex, blockIndex, at + query.length)))
              from = at + query.length
              if (hits.size >= 200) break@outer
            }
          }
        }
      }
      searchHits = hits
      hits.forEach { hit ->
        val block = book.chapters[hit.start.chapter].blocks[hit.start.block] as TextBlock
        val text = block.text
        // A few lines around the match, cut where words meet so none is split.
        var from = maxOf(0, hit.start.offset - excerptBefore)
        if (from > 0) from = text.indexOf(' ', from).let { if (it in from until hit.start.offset) it + 1 else from }
        var to = minOf(text.length, hit.end.offset + excerptAfter)
        if (to < text.length) to = text.lastIndexOf(' ', to).let { if (it > hit.end.offset) it else to }
        val lead = if (from > 0) "…" else ""
        post(
          JSONObject()
            .put("type", "searchResult")
            .put("location", hit.encode())
            .put("label", tocEntryAt(hit.start)?.label ?: JSONObject.NULL)
            .put("excerpt", lead + text.substring(from, to).replace('\n', ' ') + (if (to < text.length) "…" else ""))
            // Where the match stands in the excerpt, so the list can mark it.
            .put("matchStart", lead.length + hit.start.offset - from)
            .put("matchLength", hit.end.offset - hit.start.offset)
        )
      }
      post(JSONObject().put("type", "searchDone").put("count", hits.size))
    }
  }

  fun clearSearch() {
    searchJob?.cancel()
    searchHits = emptyList()
  }

  fun image(path: String, width: Float): ImageBitmap? {
    if (width <= 0f) return null
    images.get(path)?.let { return it }
    val bytes = book?.bytes(path) ?: return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    // An image Android cannot decode, such as an SVG, is left out.
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    // Decoded no larger than it is drawn, and never beyond about four million pixels.
    var sample = 1
    while (sample < 64 && (bounds.outWidth / (sample * 2) >= width ||
        bounds.outWidth.toLong() * bounds.outHeight / (sample.toLong() * sample) > 4_000_000L)
    ) {
      sample *= 2
    }
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: return null
    return bitmap.asImageBitmap().also { images.put(path, it) }
  }
}

/**
 * The reader: EPUB chapters laid out with Compose text into pages that slide as they turn, or one
 * long scrolling column. The app sends it commands as JSON and it reports what happens as JSON
 * events, which drive the reader screen's bars, sheets, marks and search.
 */
@OptIn(FlowPreview::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun FunctionalComposableScope.BookViewContent(
  send: AsyncFunctionHandle<String>,
  onMessage: (String) -> Unit
) {
  val scope = rememberCoroutineScope()
  val context = LocalContext.current
  val density = LocalDensity.current
  val fonts = LocalFontFamilyResolver.current
  val state = remember { BookState(scope) { json -> onMessage(json.toString()) } }
  // The book's file is let go with the reader.
  DisposableEffect(state) { onDispose { state.book?.close() } }
  val commands = remember { Channel<String>(Channel.UNLIMITED) }

  send.handle { json ->
    commands.trySend(json)
    Unit
  }

  LaunchedEffect(Unit) {
    state.post(JSONObject().put("type", "ready"))
    for (json in commands) {
      try {
        handle(state, JSONObject(json), context.cacheDir)
      } catch (cancelled: kotlinx.coroutines.CancellationException) {
        throw cancelled
      } catch (error: Exception) {
        state.post(JSONObject().put("type", "error").put("message", error.message ?: "The book could not be read"))
      }
    }
  }

  BoxWithConstraints(Modifier.fillMaxSize()) {
    val width = constraints.maxWidth
    val height = constraints.maxHeight
    val book = state.book
    val style = state.style

    // A new text size, font or page size lays the book out again at the place being read. Pages
    // are counted for the whole book first, behind a loading indicator, so page numbers are exact
    // from the start; the counts are kept, so the same book and settings open at once next time.
    LaunchedEffect(book, style, width, height) {
      if (book == null || style == null || width <= 0 || height <= 0) return@LaunchedEffect
      state.ready = false
      val measurer = TextMeasurer(fonts, density, LayoutDirection.Ltr, 0)
      val layout = BookLayout(book, style, measurer, density, width, height)
      state.relayout(layout)
      state.page = null
      val key = pageCountKey(state.source, style, width, height, density)
      val counts = withContext(Dispatchers.IO) { readPageCounts(state.cacheDir, key, book.chapters.size) }
        ?: countPages(book, style, fonts, density, width, height).also { counted ->
          withContext(Dispatchers.IO) { writePageCounts(state.cacheDir, key, counted) }
        }
      counts.forEachIndexed { chapter, count -> state.pageCounts[chapter] = count }
      state.countKey = key
      state.show(state.anchor)
      snapshotFlow { state.page }.first { it != null }
      state.ready = true
    }

    // The book fades in once it is ready; until then the page shows a loading indicator, in the
    // middle of what the app leaves uncovered.
    val shown by animateFloatAsState(if (state.ready) 1f else 0f, tween(220), label = "book-ready")
    if (shown < 1f) {
      Box(
        Modifier
          .fillMaxSize()
          .padding(bottom = state.coveredBelow.dp)
          .graphicsLayer { alpha = 1f - shown },
        contentAlignment = Alignment.Center
      ) {
        LoadingIndicator(color = style?.link ?: Color.Gray)
      }
    }

    val layout = state.layout
    if (book != null && style != null && layout != null && state.ready) {
      Box(
        Modifier
          .fillMaxSize()
          .graphicsLayer {
            alpha = shown
          }
          .pinchToOverview(state)
          .pullDownFromTop(state)
      ) {
        PagedBook(state, layout, style, width.toFloat(), height.toFloat())
      }
    }
  }
}

/** How far a finger goes up or down the page before it counts as a pull, in dp. */
private const val pullDistance = 24f

/**
 * A finger drawn down anywhere on the page while reading asks the app for its top bar, over the
 * page, without the overview; drawn up, it puts the bar away again. A tap, or a sideways drag, is
 * left to the page.
 */
private fun Modifier.pullDownFromTop(state: BookState): Modifier = pointerInput(state) {
  awaitEachGesture {
    val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
    if (state.overview || state.selection != null) return@awaitEachGesture
    val slop = viewConfiguration.touchSlop
    var pulled = false
    do {
      val event = awaitPointerEvent(PointerEventPass.Initial)
      val change = event.changes.firstOrNull { it.id == down.id } ?: break
      val dx = change.position.x - down.position.x
      val dy = change.position.y - down.position.y
      if (!pulled) {
        // Sideways first, it is a page turn; a second finger, a pinch.
        if (abs(dx) > slop && abs(dx) > abs(dy)) return@awaitEachGesture
        if (event.changes.count { it.pressed } > 1) return@awaitEachGesture
        val far = abs(dy) > pullDistance.dp.toPx() && abs(dy) > abs(dx) * 1.5f
        if (far && dy > 0f) {
          pulled = true
          state.post(JSONObject().put("type", "pullDown"))
        } else if (far && dy < 0f) {
          pulled = true
          state.post(JSONObject().put("type", "pullUp"))
        }
      }
      // Once pulled the gesture is the bar's, so the page neither turns nor reads it as a tap.
      if (pulled) event.changes.forEach { it.consume() }
    } while (event.changes.any { it.pressed })
  }
}

/**
 * Pinching moves the page between reading and the overview under the fingers, the same
 * transition a tap runs: pinched smaller the page shrinks into the overview's card and no
 * further, and spread in the overview the card grows back into the page. The app moves its bars
 * along with it. Let go past a third of the way it carries on; short of that it springs back.
 */
private fun Modifier.pinchToOverview(state: BookState): Modifier = pointerInput(state) {
  awaitEachGesture {
    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
    state.longPressed = false
    // Where the pinch started: reading (0) or the overview (1).
    val startedIn = if (state.overview) 1f else 0f
    var startDistance: Float? = null
    var last = startedIn
    var lastTime = 0L
    var speed = 0f
    do {
      val event = awaitPointerEvent(PointerEventPass.Initial)
      val pressed = event.changes.filter { it.pressed }
      if (pressed.size == 2 && state.scrub == null) {
        val distance = hypot(pressed[0].position.x - pressed[1].position.x, pressed[0].position.y - pressed[1].position.y)
        // Fingers that land together give no distance to measure against yet.
        if (startDistance == null && distance < 24f) continue
        if (startDistance == null) startDistance = distance
        val cardScale = state.card?.scale ?: 0.78f
        val scale = distance / startDistance!!
        // The card's size as a share of the way from the page to the card.
        val progress = if (startedIn == 0f) {
          ((1f - scale) / (1f - cardScale)).coerceIn(0f, 1f)
        } else {
          (1f - (cardScale * scale - cardScale) / (1f - cardScale)).coerceIn(0f, 1f)
        }
        val time = event.changes.first().uptimeMillis
        if (lastTime > 0L && time > lastTime) speed = (progress - last) / (time - lastTime) * 1000f
        last = progress
        lastTime = time
        state.pinchProgress = progress
        state.post(JSONObject().put("type", "pinchProgress").put("value", progress.toDouble()).put("ended", false).put("open", false))
        event.changes.forEach { it.consume() }
      }
    } while (event.changes.any { it.pressed })
    if (startDistance == null) return@awaitEachGesture
    val from = state.pinchProgress ?: startedIn
    // Past a third of the way from where it started, or pinched quickly, it carries on.
    val open = if (startedIn == 0f) from > 0.33f || speed > 1.5f else !(from < 0.67f || speed < -1.5f)
    state.post(JSONObject().put("type", "pinchProgress").put("value", from.toDouble()).put("ended", true).put("open", open))
    val target = if (open) 1f else 0f
    state.scope.launch {
      animate(from, target, animationSpec = tween(pinchSettle, easing = FastOutSlowInEasing)) { value, _ ->
        state.pinchProgress = value
      }
      // The zoom takes its place from here; a change of state hands it over, else the pinch lets go.
      if (state.overview != open) state.overview = open else state.pinchProgress = null
    }
  }
}

/** How long a let-go pinch takes to finish or spring back, in milliseconds. */
const val pinchSettle = 240

private suspend fun handle(state: BookState, message: JSONObject, cache: File) {
  when (message.optString("type")) {
    "open" -> {
      val uri = Uri.parse(message.getString("uri"))
      val file = File(uri.path ?: throw IllegalArgumentException("No file to open"))
      val book = withContext(Dispatchers.IO) { EpubBook.open(file) }
      if (book.chapters.isEmpty()) {
        book.close()
        throw IllegalStateException("This e-book has no text to read")
      }
      state.source = file.name
      state.cacheDir = cache
      state.book?.close()
      state.images.evictAll()
      state.book = book
      state.tocPositions = book.toc.mapNotNull { entry -> book.resolve(entry.href)?.let { it to entry } }
      val annotations = message.optJSONArray("annotations") ?: JSONArray()
      for (index in 0 until annotations.length()) state.addMark(annotations.getJSONObject(index))
      state.bookmarks = stringsOf(message.optJSONArray("bookmarks")).mapNotNull { BookPos.decode(it) }
      val location = message.optString("location").takeIf { it.isNotEmpty() && it != "null" }
      val fraction = message.optDouble("fraction", 0.0).toFloat()
      val resumed = location?.let { BookPos.decode(it) } ?: if (fraction > 0f) book.posAt(fraction) else null
      state.anchor = resumed ?: firstReadable(book)
      state.style = BookStyle.from(message.getJSONObject("style"))
      // Opened at a place carried over from listening, the sentence it picks up from is marked;
      // opened where reading left off, nothing is.
      if (resumed != null && message.optBoolean("mark", false)) state.markPlace(resumed, fromHere = location != null)
      state.post(
        JSONObject()
          .put("type", "opened")
          .put("title", book.title ?: JSONObject.NULL)
          .put("author", book.author ?: JSONObject.NULL)
          .put(
            "toc",
            JSONArray(
              book.toc.map { entry ->
                // Where the entry starts in the book, for matching it with an audiobook's chapters.
                val start = state.tocPositions.firstOrNull { it.second === entry }?.first
                JSONObject()
                  .put("label", entry.label)
                  .put("href", entry.href)
                  .put("depth", entry.depth)
                  .put("fraction", start?.let { book.fraction(it).toDouble() } ?: JSONObject.NULL)
              }
            )
          )
          .put("sectionFractions", JSONArray(book.chapterStarts.map { it.toDouble() / book.totalChars }))
      )
    }
    "style" -> state.style = BookStyle.from(message.getJSONObject("style"))
    "goTo" -> state.positionOf(message.optString("target"))?.let { navigate(state, it) }
    "goToFraction" -> state.book?.let {
      val pos = it.posAt(message.optDouble("fraction").toFloat())
      navigate(state, pos)
      state.markPlace(pos, fromHere = false)
    }
    "findPassage" -> {
      val book = state.book
      val found = book?.let {
        findPassage(it, stringsOf(message.optJSONArray("words")), message.optDouble("fraction").toFloat(), message.optString("anchor") != "start")
      }
      if (found != null) {
        navigate(state, found)
        state.markPlace(found, fromHere = false)
      }
      state.post(JSONObject().put("type", "passage").put("found", found != null))
    }
    "scrub" -> {
      state.scrubTo(message.optDouble("fraction").toFloat(), message.optBoolean("settle"))
    }
    "coveredBelow" -> state.coveredBelow = message.optDouble("height", 0.0).toFloat().coerceAtLeast(0f)
    "next" -> state.page?.let { ref -> state.next(ref)?.let { state.turned(it) } }
    "prev" -> state.page?.let { ref -> state.previous(ref)?.let { state.turned(it) } }
    "search" -> state.search(message.optString("query"))
    "clearSearch" -> state.clearSearch()
    "addAnnotation" -> message.optJSONObject("annotation")?.let { state.addMark(it) }
    "removeAnnotation" -> state.marks.remove(message.optString("value"))
    "clearSelection" -> state.clearSelection()
    "labels" -> state.labels = ReaderLabels(
      message.optString("showControls"),
      message.optString("nextPage"),
      message.optString("previousPage"),
      message.optString("highlight", "Highlight"),
      message.optString("note", "Note"),
      message.optString("copy", "Copy"),
      message.optString("share", "Share"),
    )
    "bookmarks" -> {
      state.bookmarks = stringsOf(message.optJSONArray("locations")).mapNotNull { BookPos.decode(it) }
      state.relocate()
    }
    "overview" -> {
      if (message.has("scale")) {
        state.card = OverviewCard(
          message.optDouble("scale", 0.78).toFloat(),
          message.optDouble("shift", 0.0).toFloat(),
          message.optDouble("gap", 12.0).toFloat(),
          message.optDouble("radius", 20.0).toFloat()
        )
      }
      state.overview = message.optBoolean("on")
      state.clearSelection()
    }
  }
}

private fun firstReadable(book: EpubBook) =
  BookPos(book.chapters.indexOfFirst { it.blocks.isNotEmpty() }.coerceAtLeast(0), 0, 0)

private fun stringsOf(array: JSONArray?): List<String> =
  if (array == null) emptyList() else (0 until array.length()).map { array.getString(it) }

/**
 * Counts every chapter's pages, on as many threads as the phone has cores, each with its
 * own text measurer; the chapters' layouts are dropped as soon as they are counted.
 */
private suspend fun countPages(
  book: EpubBook,
  style: BookStyle,
  fonts: androidx.compose.ui.text.font.FontFamily.Resolver,
  density: Density,
  width: Int,
  height: Int
): IntArray = withContext(Dispatchers.Default) {
  val chapters = book.chapters.size
  val counts = IntArray(chapters) { 1 }
  // Nothing else runs while the book loads, so every core counts.
  val workers = Runtime.getRuntime().availableProcessors().coerceIn(1, 8)
  // The longest chapters first, dealt out in turn, so the threads finish together.
  val order = book.chapters.indices.sortedByDescending { book.chapters[it].length }
  coroutineScope {
    (0 until workers).map { worker ->
      async {
        val layout = BookLayout(
          book, style, TextMeasurer(fonts, density, LayoutDirection.Ltr, 0), density, width, height,
          forReading = false
        )
        for (index in worker until chapters step workers) {
          ensureActive()
          val chapter = order[index]
          counts[chapter] = runCatching { layout.paginate(chapter).pages.size }.getOrDefault(1)
        }
      }
    }.awaitAll()
  }
  counts
}

/** Page counts are kept per book, per setting that moves text and per page size. */
private fun pageCountKey(source: String, style: BookStyle, width: Int, height: Int, density: Density) =
  listOf(
    pageCountVersion, source, style.layoutKey(), width, height, density.density, density.fontScale
  ).joinToString("|").hashCode().toUInt().toString(16)

/** Raised when the way pages are laid out changes, so counts kept from before are not used. */
private const val pageCountVersion = 4

private fun pageCountFile(cache: File?, key: String) = cache?.let { File(File(it, "book-pages"), "$key.txt") }

/** How many books' page counts are kept, the most recently opened; each file is a few bytes. */
private const val pageCountsKept = 200

private fun readPageCounts(cache: File?, key: String, chapters: Int): IntArray? = runCatching {
  val file = pageCountFile(cache, key) ?: return null
  if (!file.exists()) return null
  val counts = file.readText().split(',').map { it.trim().toInt() }
  // Marked used, so counts still opened outlast those that are not.
  file.setLastModified(System.currentTimeMillis())
  if (counts.size == chapters) counts.toIntArray() else null
}.getOrNull()

private fun writePageCounts(cache: File?, key: String, counts: IntArray) {
  runCatching {
    val file = pageCountFile(cache, key) ?: return
    file.parentFile?.mkdirs()
    // Written beside it and moved into place, so a file cut short is never read as counts.
    val part = File(file.parentFile, file.name + ".part")
    part.writeText(counts.joinToString(","))
    if (!part.renameTo(file)) part.delete()
    // Only the most recently used are kept, so counts for books and settings long gone go too.
    file.parentFile?.listFiles()
      ?.sortedByDescending { it.lastModified() }
      ?.drop(pageCountsKept)
      ?.forEach { it.delete() }
  }
}

/** Moves to a place: the page it is on. */
private fun navigate(state: BookState, pos: BookPos) {
  state.clearSelection()
  // In the overview the row of cards scrolls over to the new page rather than switching.
  state.pendingSlide = if (state.overview) pos.compareTo(state.anchor).coerceIn(-1, 1) else 0
  state.show(pos)
}

/** The page card's place in the overview, as the app lays out its bars around it, in dp. */
class OverviewCard(val scale: Float, val shift: Float, val gap: Float, val radius: Float)

/** A turn in progress: the page sliding away, the page coming in, and where it ends. */
private class Curl(val forward: Boolean, val moving: PageRef, val under: PageRef, val target: PageRef)

private val overviewEasing = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/**
 * The book as pages. Turning slides the page off to the side as the next one follows it in, under
 * the finger or on a tap at the page's edge. In the overview the pages become a row of
 * cards: dragging scrolls the row page by page, and tapping the card beside the middle one turns
 * to it.
 */
@Composable
private fun PagedBook(state: BookState, layout: BookLayout, style: BookStyle, width: Float, height: Float) {
  val scope = rememberCoroutineScope()
  val density = LocalDensity.current
  val px = density.density
  val zoom = remember { Animatable(if (state.overview) 1f else 0f) }
  val slide = remember { Animatable(0f) }
  val progress = remember { Animatable(0f) }
  var curl by remember { mutableStateOf<Curl?>(null) }
  val handleRadius = with(density) { 8.dp.toPx() }
  val view = LocalView.current
  val context = LocalContext.current
  // The strips along the sides where Android's back gesture starts; a finger held there is going
  // back, not selecting.
  val gestures = WindowInsets.systemGestures
  val direction = LocalLayoutDirection.current
  val backEdgeLeft = gestures.getLeft(density, direction).toFloat()
  val backEdgeRight = gestures.getRight(density, direction).toFloat()
  /** Where the magnifier looks while a selection is dragged; unspecified hides it. */
  var magnifierAt by remember { mutableStateOf(Offset.Unspecified) }

  /** Moves the selection, with the tick Android gives each character a handle reaches. */
  fun moveSelection(range: BookRange) {
    if (range == state.selection) return
    state.selection = range
    view.performHapticFeedback(
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) HapticFeedbackConstants.TEXT_HANDLE_MOVE else HapticFeedbackConstants.CLOCK_TICK
    )
  }

  SelectionToolbar(state, layout, view, context, handleRadius)
  val card = state.card
  val cardScale = card?.scale ?: 0.78f
  val cardShift = (card?.shift ?: 0f) * px
  val cardGap = (card?.gap ?: 12f) * px
  val cardRadius = (card?.radius ?: 20f) * px
  val spacing = width * cardScale + cardGap

  LaunchedEffect(state.overview) {
    // Pinched part of the way, the zoom carries on from where the fingers left it.
    state.pinchProgress?.let { from ->
      zoom.snapTo(from)
      state.pinchProgress = null
    }
    zoom.animateTo(if (state.overview) 1f else 0f, tween(320, easing = overviewEasing))
  }

  // How far the bookmark ribbon of the page being read hangs down, in dp. Turning to a page shows
  // its ribbon as it is; bookmarking it drops the ribbon with a spring and draws it back up until
  // only its tip shows, and taking the bookmark away drops it the same way and draws it up out of
  // sight.
  val ribbon = remember { Animatable(0f) }
  val here = state.page
  val marked = here?.let { state.bookmarksOn(it).isNotEmpty() } ?: false
  val shownRibbon = remember { mutableStateOf<Pair<PageRef?, Boolean>?>(null) }
  LaunchedEffect(here, marked) {
    val before = shownRibbon.value
    shownRibbon.value = here to marked
    if (before == null || before.first != here) {
      ribbon.snapTo(if (marked) ribbonTip else 0f)
      return@LaunchedEffect
    }
    if (before.second == marked) return@LaunchedEffect
    ribbon.animateTo(ribbonDrop, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMediumLow))
    delay(if (marked) 380 else 160)
    ribbon.animateTo(if (marked) ribbonTip else 0f, tween(if (marked) 340 else 260, easing = FastOutSlowInEasing))
  }

  /** How far a page's ribbon hangs, in dp: the moving one for the page being read. */
  fun ribbonOf(ref: PageRef?): Float = when {
    ref == null -> 0f
    ref == here -> ribbon.value
    state.bookmarksOn(ref).isNotEmpty() -> ribbonTip
    else -> 0f
  }

  fun startCurl(forward: Boolean): Curl? {
    val from = state.page ?: return null
    return if (forward) {
      state.next(from)?.let { Curl(true, from, it, it) }
    } else {
      state.previous(from)?.let { Curl(false, it, from, it) }
    }
  }

  /** Lets a turn finish or fall back; a finished one moves the book on. */
  fun settle(active: Curl, complete: Boolean) {
    scope.launch {
      val end = if (active.forward == complete) 1f else 0f
      progress.animateTo(end, tween(if (complete) 280 else 200, easing = FastOutSlowInEasing))
      if (complete) state.turned(active.target)
      curl = null
    }
  }

  /** A tap at the page's edge goes straight to the next or previous page, without a slide. */
  fun jump(forward: Boolean) {
    if (curl != null) return
    val from = state.page ?: return
    val target = (if (forward) state.next(from) else state.previous(from)) ?: return
    state.turned(target)
  }

  // Let go, the slider's row eases the last part of a card onto the page it settled on.
  // While the slider moves, the row of sketched cards moves with the finger rather than with the
  // page count: a sweep across the whole slider passes a set number of cards, so a wobble is a
  // small, smooth slide back and forth, a change of direction turns the row at once, and it
  // stops when the finger stops. The header's page count follows the slider exactly.
  val glide = remember { mutableStateOf(0f) }
  var scrubbing by remember { mutableStateOf(false) }
  // How much the cards show their sketch rather than their text: faded in as a scrub starts, and
  // out again once the page it settled on is laid out.
  val sketch = remember { Animatable(0f) }
  var scrubStart by remember { mutableStateOf(0) }
  LaunchedEffect(Unit) {
    val effect = this
    snapshotFlow { state.scrub != null }.collect { active ->
      if (active) {
        effect.launch { sketch.animateTo(1f, tween(160)) }
        scrubbing = true
        scrubStart = state.page?.let { state.globalOf(it) } ?: (state.scrub ?: 0f).roundToInt()
        glide.value = 0f
        var last = withFrameNanos { it }
        while (state.scrub != null) {
          val now = withFrameNanos { it }
          val seconds = (now - last) / 1_000_000_000f
          last = now
          val scrub = state.scrub ?: break
          val pages = maxOf(1, state.totalPages - 1)
          val target = (scrub - scrubStart) / pages * sweepCards
          // A light smoothing of the finger's steps, quick enough to feel direct.
          glide.value += (target - glide.value) * (1f - kotlin.math.exp(-glideRate * seconds))
        }
      } else if (scrubbing) {
        scrubbing = false
        // Let go, the row eases onto the page it settled on, at most half a card away.
        val from = (glide.value - glide.value.roundToInt()).coerceIn(-0.5f, 0.5f)
        slide.snapTo(-from * spacing)
        effect.launch {
          snapshotFlow { state.pageAt(state.page) != null }.first { it }
          sketch.animateTo(0f, tween(260))
        }
        slide.animateTo(0f, tween(220, easing = overviewEasing))
      }
    }
  }

  // Moved from outside, such as by the slider or the contents, the overview's row slides over.
  LaunchedEffect(state.page) {
    val direction = state.pendingSlide
    state.pendingSlide = 0
    if (direction != 0 && state.overview) {
      slide.snapTo(direction * spacing)
      slide.animateTo(0f, tween(260, easing = overviewEasing))
    }
  }

  /** Scrolls the overview's row one card on, keeping it where it is on screen. */
  fun step(forward: Boolean): Boolean {
    val from = state.page ?: return false
    val target = state.refOf(state.globalOf(from) + if (forward) 1 else -1) ?: return false
    state.go(target)
    scope.launch { slide.snapTo(slide.value + if (forward) spacing else -spacing) }
    return true
  }

  // Gestures outlive this composition, so they read the page and layout of the moment.
  fun hitAt(point: Offset): Hit? {
    val page = state.pageAt(state.page) ?: return null
    val layout = state.layout ?: return null
    val x = point.x - layout.textLeft
    val y = point.y - layout.textTop
    val texts = page.items.filterIsInstance<PlacedText>()
    val item = texts.firstOrNull { y >= it.top && y <= it.top + it.height }
      ?: texts.minByOrNull { minOf(abs(y - it.top), abs(y - it.top - it.height)) } ?: return null
    val local = Offset(x, (y - item.top).coerceIn(0f, item.height - 1f) + item.layoutTop)
    val offsetInBlock = offsetAt(item.layout, local).coerceIn(item.startOffset, item.endOffset)
    return Hit(page.chapter, item.block, offsetInBlock)
  }

  Box(
    Modifier
      .fillMaxSize()
      // Android's own magnifier, over the line a selection is being dragged along.
      .magnifier(sourceCenter = { magnifierAt }, zoom = 1.25f)
      // TalkBack cannot aim a tap at the page's middle or edges, so they are offered as actions.
      .semantics {
        onClick(label = state.labels.showControls) {
          state.post(JSONObject().put("type", "tap"))
          true
        }
        customActions = listOf(
          CustomAccessibilityAction(state.labels.nextPage) { jump(true); true },
          CustomAccessibilityAction(state.labels.previousPage) { jump(false); true },
        )
      }
      .pointerInput(state, width, spacing) {
        detectTapGestures { point ->
          if (state.longPressed) {
            state.longPressed = false
            return@detectTapGestures
          }
          if (state.overview) {
            // The card beside the middle one turns to it; anywhere else leaves the overview.
            val cardLeft = width / 2f - width * cardScale / 2f
            val offsetX = point.x - cardLeft - slide.value
            when {
              offsetX > width * cardScale + cardGap / 2 -> if (step(true)) scope.launch { slide.animateTo(0f, tween(300, easing = overviewEasing)) }
              offsetX < -cardGap / 2 -> if (step(false)) scope.launch { slide.animateTo(0f, tween(300, easing = overviewEasing)) }
              else -> state.post(JSONObject().put("type", "tap"))
            }
            return@detectTapGestures
          }
          if (state.selection != null) {
            state.post(JSONObject().put("type", "tap"))
            return@detectTapGestures
          }
          // The top corner at the end of the page bookmarks it, or takes its bookmark away.
          if (point.x > width - bookmarkCornerWidth.dp.toPx() && point.y < bookmarkCornerHeight.dp.toPx()) {
            state.toggleBookmarkHere()
            return@detectTapGestures
          }
          val hit = hitAt(point)
          val book = state.book
          if (hit != null && book != null) {
            val pos = BookPos(hit.chapter, hit.block, hit.offset)
            state.marks.entries.firstOrNull { pos in it.value.range }?.let { entry ->
              state.post(JSONObject().put("type", "showAnnotation").put("value", entry.key))
              return@detectTapGestures
            }
            val block = book.chapters[hit.chapter].blocks[hit.block] as? TextBlock
            val link = block?.spans?.firstOrNull { it.href != null && hit.offset >= it.start && hit.offset < it.end }?.href
            // A link into the book goes there; any other tap on it reads as a tap on the page.
            val target = link?.takeIf { !it.contains("://") && !it.startsWith("mailto:") }?.let { book.resolve(it) }
            if (target != null) {
              navigate(state, target)
              return@detectTapGestures
            }
          }
          when {
            point.x < width * 0.25f -> jump(false)
            point.x > width * 0.75f -> jump(true)
            else -> state.post(JSONObject().put("type", "tap"))
          }
        }
      }
      .pointerInput(state, width, spacing) {
        val velocity = VelocityTracker()
        var dragged = 0f
        var active: Curl? = null
        detectHorizontalDragGestures(
          onDragStart = {
            velocity.resetTracking()
            dragged = 0f
            active = null
          },
          onDragEnd = {
            val speed = velocity.calculateVelocity().x
            if (state.overview) {
              // A fling carries on to the next card; the row then settles on the nearest.
              if (speed < -700f && slide.value < 0f) step(true)
              if (speed > 700f && slide.value > 0f) step(false)
              scope.launch { slide.animateTo(0f, tween(300, easing = overviewEasing)) }
              return@detectHorizontalDragGestures
            }
            val turning = active ?: return@detectHorizontalDragGestures
            val done = if (turning.forward) progress.value > 0.3f || speed < -600f else progress.value < 0.7f || speed > 600f
            settle(turning, done && (if (turning.forward) speed < 600f else speed > -600f))
          },
          onDragCancel = {
            if (state.overview) scope.launch { slide.animateTo(0f, tween(300)) }
            active?.let { settle(it, false) }
          },
          onHorizontalDrag = { change, amount ->
            if (state.selection != null || state.pinchProgress != null) return@detectHorizontalDragGestures
            velocity.addPointerInputChange(change)
            change.consume()
            if (state.overview) {
              val from = state.page ?: return@detectHorizontalDragGestures
              var next = slide.value + amount
              if (next > 0 && state.previous(from) == null) next = 0f
              if (next < 0 && state.next(from) == null) next = 0f
              scope.launch {
                slide.snapTo(next)
                // The nearest card is always the one being read, so the row scrolls on freely.
                if (slide.value < -spacing / 2) step(true)
                if (slide.value > spacing / 2) step(false)
              }
              return@detectHorizontalDragGestures
            }
            dragged += amount
            if (active == null && curl == null) {
              active = startCurl(dragged < 0)
              active?.let { started ->
                curl = started
                scope.launch { progress.snapTo(if (started.forward) 0f else 1f) }
              }
            }
            val turning = active ?: return@detectHorizontalDragGestures
            val share = (abs(dragged) / width).coerceIn(0f, 1f)
            scope.launch { progress.snapTo(if (turning.forward) share else 1f - share) }
          }
        )
      }
      .pointerInput(state, width, backEdgeLeft, backEdgeRight) {
        // A long press selects the word under it, with the buzz Android gives it, and dragging on
        // extends the selection with a tick at each character it reaches, under a magnifier.
        fun finish() {
          magnifierAt = Offset.Unspecified
          state.selecting = false
          state.postSelection()
        }
        detectDragGesturesAfterLongPress(
          onDragStart = { point ->
            if (state.overview || curl != null) return@detectDragGesturesAfterLongPress
            if (point.x < backEdgeLeft || point.x > width - backEdgeRight) return@detectDragGesturesAfterLongPress
            val hit = hitAt(point) ?: return@detectDragGesturesAfterLongPress
            state.longPressed = true
            state.selecting = true
            state.selection = wordAt(state, hit)
            view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            magnifierAt = magnifierSource(state, layout, point, BookPos(hit.chapter, hit.block, hit.offset))
          },
          onDrag = { change, _ ->
            val start = state.selection?.start ?: return@detectDragGesturesAfterLongPress
            val hit = hitAt(change.position) ?: return@detectDragGesturesAfterLongPress
            val pos = BookPos(hit.chapter, hit.block, hit.offset)
            moveSelection(rangeBetween(start, pos))
            magnifierAt = magnifierSource(state, layout, change.position, pos)
            change.consume()
          },
          onDragEnd = { finish() },
          // Android takes the touch over, as its back gesture does: nothing stays selected.
          onDragCancel = {
            magnifierAt = Offset.Unspecified
            state.selecting = false
            state.longPressed = false
            state.clearSelection()
          }
        )
      }
      .pointerInput(state, width) {
        // The selection's handles move either end of it.
        awaitEachGesture {
          val down = awaitFirstDown(requireUnconsumed = false)
          val selection = state.selection ?: return@awaitEachGesture
          val page = state.pageAt(state.page) ?: return@awaitEachGesture
          val ends = handlePositions(page, state.layout ?: return@awaitEachGesture, selection)
          val grabbed = ends.withIndex().minByOrNull { (_, point) -> (point - down.position).getDistance() }
            ?.takeIf { (_, point) -> point != null && (point - down.position).getDistance() < handleRadius * 3 }
            ?: return@awaitEachGesture
          down.consume()
          state.longPressed = true
          state.selecting = true
          drag(down.id) { change ->
            // The handle hangs below the text, so the point above it is the one it marks.
            val point = change.position - Offset(0f, handleRadius * 2)
            val hit = hitAt(point)
            val current = state.selection
            if (hit != null && current != null) {
              val pos = BookPos(hit.chapter, hit.block, hit.offset)
              moveSelection(if (grabbed.index == 0) rangeBetween(current.end, pos) else rangeBetween(current.start, pos))
              magnifierAt = magnifierSource(state, layout, point, pos)
            }
            change.consume()
          }
          magnifierAt = Offset.Unspecified
          state.selecting = false
          state.postSelection()
        }
      }
  ) {
    Canvas(Modifier.fillMaxSize()) {
      // A pinch in progress drives the zoom directly; otherwise its animation does.
      val z = state.pinchProgress ?: zoom.value
      val active = curl
      if (active != null && z == 0f) {
        // The page slides off to the left as the next comes in beside it, or back the other way.
        val shift = progress.value * width
        listOf(active.moving to -shift, active.under to width - shift).forEach { (ref, left) ->
          val page = state.pageAt(ref) ?: return@forEach
          translate(left, 0f) {
            drawRect(style.background)
            drawPage(state, layout, style, page, null, 0f)
            drawRibbon(style, width, ribbonOf(ref))
          }
        }
        return@Canvas
      }
      val scale = 1f - (1f - cardScale) * z
      val gap = width + (spacing - width) * z
      // Pages are placed by their number in the book, so the row runs on across chapters; a page
      // whose chapter is still being laid out shows as a blank card until it is.
      // Scrubbing, the cards are sketches placed by the finger's travel, not by page, so they run
      // on freely; otherwise each card is a page of the book in its place.
      val scrubbed = if (scrubbing) glide.value else null
      val base = if (scrubbed != null) scrubStart + scrubbed.roundToInt()
        else state.page?.let { state.globalOf(it) } ?: return@Canvas
      val total = state.totalPages
      // Where the slider is in the book while scrubbing, as a page number that may fall between two.
      val at = if (scrubbed != null && total > 0) {
        (state.scrub ?: (scrubStart + scrubbed)).coerceIn(0f, (total - 1).toFloat())
      } else null
      // Within a page of either end the middle card settles into the centre, as it does let go.
      val atEnd = if (at != null) minOf(at, total - 1 - at).coerceIn(0f, 1f) else 1f
      val drift = if (scrubbed != null) (scrubbed - scrubbed.roundToInt()) * atEnd else 0f
      for (slot in -2..2) {
        val number = base + slot
        // A scrub keeps the pages it starts from until their sketch has faded in over them.
        val page = if (scrubbed != null) {
          if (sketch.value < 1f && scrubbed.roundToInt() == 0) state.page?.let { current ->
            state.refOf(state.globalOf(current) + slot)?.let { state.pageAt(it) }
          } else null
        } else {
          if (number < 0 || (total > 0 && number >= total)) continue
          state.pageAt(state.refOf(number) ?: continue)
        }
        val left = (slot - drift) * gap + slide.value
        if (left > width || left < -width * 1.1f) continue
        // Scrubbing, the cards beside the middle one run out as the slider nears either end of the
        // book, as they do once it is let go: a card fades over the last page before its side ends.
        val shown = if (at != null && slot != 0) {
          val room = if (slot > 0) total - 1 - at else at
          (room - abs(slot) + 1f).coerceIn(0f, 1f)
        } else 1f
        if (shown <= 0f) continue
        withTransform({
          translate(left, cardShift * z)
          scale(scale, scale, Offset(width / 2f, height / 2f))
        }) {
          val corner = if (z > 0f) cardRadius * z / scale else 0f
          faded(shown, width, height) {
            clipPath(Path().apply { addRoundRect(RoundRect(0f, 0f, width, height, CornerRadius(corner))) }) {
              drawRect(style.background)
              val amount = if (page == null) 1f else sketch.value
              if (page != null && amount < 1f) {
                faded(1f - amount, width, height) {
                  drawPage(state, layout, style, page, if (slot == 0 && z == 0f && amount == 0f) state.selection else null, handleRadius)
                  drawRibbon(style, width, ribbonOf(if (scrubbed != null) null else state.refOf(number)))
                }
              }
              if (amount > 0f) {
                drawSketch(layout, style, number, alpha = amount)
              }
            }
          }
        }
      }
    }
  }
}

/** The corner of the page a tap bookmarks it in, from its top end, in dp. */
private const val bookmarkCornerWidth = 72f
private const val bookmarkCornerHeight = 80f

/** The bookmark ribbon: its tip showing on a bookmarked page, and how far it drops, in dp. */
private const val ribbonTip = 26f
private const val ribbonDrop = 48f
private const val ribbonWidth = 26f
private const val ribbonNotch = 8f
/** From the page's end edge to the ribbon's middle, in dp. */
private const val ribbonInset = 40f

/** Draws a bookmark ribbon hanging from the page's top, `length` dp long, notched at its foot. */
private fun DrawScope.drawRibbon(style: BookStyle, pageWidth: Float, length: Float) {
  if (length <= 0f) return
  val half = ribbonWidth.dp.toPx() / 2f
  val middle = pageWidth - ribbonInset.dp.toPx()
  val bottom = length.dp.toPx()
  val notch = minOf(ribbonNotch.dp.toPx(), bottom)
  val ribbon = Path().apply {
    moveTo(middle - half, 0f)
    lineTo(middle + half, 0f)
    lineTo(middle + half, bottom)
    lineTo(middle, bottom - notch)
    lineTo(middle - half, bottom)
    close()
  }
  drawPath(ribbon, style.link)
}

/** Draws something at an opacity, through a layer only when it is partly see-through. */
private inline fun DrawScope.faded(alpha: Float, width: Float, height: Float, draw: DrawScope.() -> Unit) {
  if (alpha >= 1f) {
    draw()
    return
  }
  drawIntoCanvas { canvas ->
    canvas.saveLayer(androidx.compose.ui.geometry.Rect(0f, 0f, width, height), androidx.compose.ui.graphics.Paint().apply { this.alpha = alpha })
    draw()
    canvas.restore()
  }
}

/**
 * A page sketched rather than set: soft bars where its lines of text would run, in paragraphs
 * that differ from page to page. Like a set page it carries no number; the header counts pages.
 * Drawn while the slider sweeps through the book, where laying out real pages would stutter,
 * and while a page's chapter is still being laid out.
 */
private fun DrawScope.drawSketch(
  layout: BookLayout,
  style: BookStyle,
  number: Int,
  alpha: Float = 1f
) {
  val base = 16f * style.fontSize / 100f * density
  val line = base * style.lineHeight
  val bar = base * 0.5f
  val ink = style.foreground.copy(alpha = 0.1f * alpha)
  val random = kotlin.random.Random(number * 7919 + 17)
  var y = layout.textTop + (line - bar) / 2f
  var paragraphLeft = 3 + random.nextInt(6)
  var first = true
  while (y + bar < layout.textTop + layout.textHeight) {
    val last = paragraphLeft == 1
    val indent = if (first) base * 1.4f else 0f
    val length = if (last) layout.textWidth * (0.25f + random.nextFloat() * 0.6f) else layout.textWidth.toFloat()
    drawRoundRect(
      ink,
      topLeft = Offset(layout.textLeft + indent, y),
      size = Size(length - indent, bar),
      cornerRadius = CornerRadius(bar / 2f)
    )
    y += line
    paragraphLeft--
    first = false
    if (paragraphLeft == 0) {
      paragraphLeft = 2 + random.nextInt(8)
      first = true
    }
  }
}

private operator fun Offset?.minus(other: Offset): Offset = if (this == null) Offset(Float.MAX_VALUE, Float.MAX_VALUE) else Offset(x - other.x, y - other.y)

/** The ends of a selection on the page, where its handles hang, in view pixels. */
private fun handlePositions(page: BookPage, layout: BookLayout, range: BookRange): List<Offset?> {
  fun at(pos: BookPos, end: Boolean): Offset? {
    val item = page.items.filterIsInstance<PlacedText>().firstOrNull {
      it.block == pos.block && pos.offset >= it.startOffset && (pos.offset < it.endOffset || (end && pos.offset == it.endOffset))
    } ?: return null
    val line = item.layout.getLineForOffset(if (end) (pos.offset - 1).coerceAtLeast(item.startOffset) else pos.offset)
    val x = visualX(item.layout, pos.offset, line)
    return Offset(layout.textLeft + x, layout.textTop + item.top + item.layout.getLineBottom(line) - item.layoutTop)
  }
  if (page.chapter != range.start.chapter) return listOf(null, null)
  return listOf(at(range.start, false), at(range.end, true))
}

/**
 * Where the magnifier looks for a finger at `point` on the character at `pos`: level with the
 * finger, and centred on the character's line, as Android's own magnifier follows a line.
 */
private fun magnifierSource(state: BookState, layout: BookLayout, point: Offset, pos: BookPos): Offset {
  val page = state.pageAt(state.page) ?: return point
  val item = page.items.filterIsInstance<PlacedText>().firstOrNull {
    it.block == pos.block && pos.offset >= it.startOffset && pos.offset <= it.endOffset
  } ?: return point
  val line = item.layout.getLineForOffset(pos.offset.coerceAtMost(item.endOffset - 1).coerceAtLeast(item.startOffset))
  val middle = (item.layout.getLineTop(line) + item.layout.getLineBottom(line)) / 2
  return Offset(point.x, layout.textTop + item.top - item.layoutTop + middle)
}

/** The box around the part of a selection on the page, in view pixels, or null if none of it is. */
private fun selectionBounds(page: BookPage, layout: BookLayout, range: BookRange): androidx.compose.ui.geometry.Rect? {
  if (page.chapter != range.start.chapter) return null
  var bounds: androidx.compose.ui.geometry.Rect? = null
  page.items.filterIsInstance<PlacedText>().forEach { item ->
    val from = when {
      range.start.block < item.block -> item.startOffset
      range.start.block == item.block -> range.start.offset
      else -> return@forEach
    }
    val to = when {
      range.end.block > item.block -> item.endOffset
      range.end.block == item.block -> range.end.offset
      else -> return@forEach
    }
    val start = maxOf(from, item.startOffset)
    val end = minOf(to, item.endOffset)
    if (start >= end) return@forEach
    rangeRects(item.layout, start, end).forEach { rect ->
      val placed = rect.translate(layout.textLeft, layout.textTop + item.top - item.layoutTop)
      bounds = bounds?.let {
        androidx.compose.ui.geometry.Rect(
          minOf(it.left, placed.left), minOf(it.top, placed.top), maxOf(it.right, placed.right), maxOf(it.bottom, placed.bottom)
        )
      } ?: placed
    }
  }
  return bounds
}

/** The toolbar's own items; the apps that act on text follow them, numbered from `processText`. */
private const val itemHighlight = 1
private const val itemNote = 2
private const val itemCopy = 3
private const val itemShare = 4
private const val processText = 100

/**
 * Android's floating text toolbar over a selection, once the finger that made it lifts: Highlight
 * and Note, which the app carries out, then Copy, Share and the apps that act on selected text,
 * such as Translate. It hides while the selection is dragged, the page turns or the overview opens.
 * Closed by the system, such as with Back, it takes the selection with it.
 */
@Composable
private fun SelectionToolbar(state: BookState, layout: BookLayout, view: android.view.View, context: Context, handleRadius: Float) {
  val range = state.selection?.takeIf { !state.selecting && !state.overview }
  val page = state.page
  DisposableEffect(range, page, layout, state.labels) {
    val shown = range ?: return@DisposableEffect onDispose {}
    val bounds = state.pageAt(page)?.let { selectionBounds(it, layout, shown) } ?: return@DisposableEffect onDispose {}
    val text = state.textOf(shown).trim()
    val labels = state.labels
    // Closing it from here, as the selection changes, leaves the selection as it is.
    var closing = false
    val readers = context.packageManager.queryIntentActivities(
      Intent(Intent.ACTION_PROCESS_TEXT).setType("text/plain"), 0
    ).sortedBy { it.loadLabel(context.packageManager).toString() }

    fun launch(intent: Intent) {
      if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { context.startActivity(intent) }
    }

    val mode = view.startActionMode(object : ActionMode.Callback2() {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        menu.add(Menu.NONE, itemHighlight, 1, labels.highlight).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(Menu.NONE, itemNote, 2, labels.note).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(Menu.NONE, itemCopy, 3, labels.copy).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(Menu.NONE, itemShare, 4, labels.share).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        readers.forEachIndexed { index, reader ->
          menu.add(Menu.NONE, processText + index, 10 + index, reader.loadLabel(context.packageManager))
            .setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        }
        return true
      }

      override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = false

      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        when (item.itemId) {
          // The app keeps the highlight and asks for the note, then lets the selection go.
          itemHighlight -> state.post(JSONObject().put("type", "selectionAction").put("action", "highlight"))
          itemNote -> {
            closing = true
            mode.finish()
            state.post(JSONObject().put("type", "selectionAction").put("action", "note"))
          }
          itemCopy -> {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText(null, text))
            state.clearSelection()
          }
          itemShare -> {
            launch(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null))
            state.clearSelection()
          }
          else -> readers.getOrNull(item.itemId - processText)?.let { reader ->
            launch(
              Intent(Intent.ACTION_PROCESS_TEXT)
                .setType("text/plain")
                .setClassName(reader.activityInfo.packageName, reader.activityInfo.name)
                .putExtra(Intent.EXTRA_PROCESS_TEXT, text)
                .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
            )
            state.clearSelection()
          }
        }
        return true
      }

      override fun onDestroyActionMode(mode: ActionMode) {
        if (!closing) state.clearSelection()
      }

      // The handles hang below the text; the toolbar keeps clear of them, as it does in a text view.
      override fun onGetContentRect(mode: ActionMode, view: android.view.View, outRect: android.graphics.Rect) {
        outRect.set(bounds.left.toInt(), bounds.top.toInt(), bounds.right.toInt(), (bounds.bottom + handleRadius * 2).toInt())
      }
    }, ActionMode.TYPE_FLOATING)

    onDispose {
      closing = true
      mode?.finish()
    }
  }
}

/**
 * Where a character sits on a line as drawn. Android draws justified lines with their spaces
 * stretched but reports positions as if they were not; each space before the character adds its
 * share of the line's spare width, taken from the paragraph laid out plainly.
 */
private fun visualX(layout: TextLayoutResult, offset: Int, line: Int = layout.getLineForOffset(offset)): Float {
  // A line's end offset can belong to the next line, as at a hyphenated break; its place on this
  // line is after the line's last character.
  val x = if (offset >= layout.getLineEnd(line, visibleEnd = true)) {
    measuredEnd(layout, line)
  } else {
    layout.getHorizontalPosition(offset, usePrimaryDirection = true)
  }
  val stretch = spaceStretch(layout, line) ?: return x
  val text = layout.layoutInput.text.text
  val start = layout.getLineStart(line)
  var spaces = 0
  for (index in start until minOf(offset, text.length)) if (isStretchable(text[index])) spaces++
  return x + stretch * spaces
}

private fun isStretchable(character: Char) = character == ' '

/** Where a line ends before any stretching, its hyphen included. */
private fun measuredEnd(layout: TextLayoutResult, line: Int): Float =
  naturalEnds[layout]?.getOrNull(line) ?: layout.getLineRight(line)

/** How much wider each space on a justified line is drawn than reported, or null if not at all. */
private fun spaceStretch(layout: TextLayoutResult, line: Int): Float? {
  if (layout.layoutInput.style.textAlign != androidx.compose.ui.text.style.TextAlign.Justify) return null
  if (line >= layout.lineCount - 1 || naturalEnds[layout] == null) return null
  val text = layout.layoutInput.text.text
  val start = layout.getLineStart(line)
  val end = layout.getLineEnd(line, visibleEnd = true)
  if (end < text.length && text[end] == '\n') return null
  // Spaces between words only: not those the line ends on, which are not drawn.
  var spaces = 0
  for (index in start until end) if (isStretchable(text[index])) spaces++
  if (spaces == 0) return null
  val spare = layout.layoutInput.constraints.maxWidth - measuredEnd(layout, line)
  return if (spare > 0.5f) spare / spaces else null
}

/** The character under a point, as drawn, justified lines included. */
private fun offsetAt(layout: TextLayoutResult, point: Offset): Int {
  val line = layout.getLineForVerticalPosition(point.y)
  if (spaceStretch(layout, line) == null) return layout.getOffsetForPosition(point)
  val start = layout.getLineStart(line)
  val end = layout.getLineEnd(line, visibleEnd = true)
  var best = start
  for (offset in start..end) {
    if (visualX(layout, offset, line) <= point.x) best = offset else break
  }
  // The nearer edge of the character the point is on.
  if (best < end) {
    val left = visualX(layout, best, line)
    val right = visualX(layout, best + 1, line)
    if (point.x - left > right - point.x) best++
  }
  return best
}

/**
 * The rectangles a stretch of text covers, line by line. Built from character positions, which
 * follow justified spacing; Android's own selection path does not, and drifts on justified lines.
 */
private fun rangeRects(layout: TextLayoutResult, start: Int, end: Int): List<androidx.compose.ui.geometry.Rect> {
  if (start >= end) return emptyList()
  val first = layout.getLineForOffset(start)
  val last = layout.getLineForOffset((end - 1).coerceAtLeast(start))
  return (first..last).map { line ->
    val from = maxOf(start, layout.getLineStart(line))
    val to = minOf(end, layout.getLineEnd(line, visibleEnd = true))
    val left = visualX(layout, from, line)
    val right = visualX(layout, to, line)
    androidx.compose.ui.geometry.Rect(minOf(left, right), layout.getLineTop(line), maxOf(left, right), layout.getLineBottom(line))
  }
}

private fun DrawScope.fillRange(layout: TextLayoutResult, span: IntRange, color: Color, alpha: Float, blendMode: BlendMode = BlendMode.SrcOver) {
  rangeRects(layout, span.first, span.last + 1).forEach { rect ->
    drawRect(color, rect.topLeft, rect.size, alpha = alpha, blendMode = blendMode)
  }
}

private fun rangeBetween(a: BookPos, b: BookPos): BookRange = if (a <= b) BookRange(a, b) else BookRange(b, a)

/** The word under a point, as a long press selects it. */
private fun wordAt(state: BookState, hit: Hit): BookRange {
  val block = state.book?.chapters?.getOrNull(hit.chapter)?.blocks?.getOrNull(hit.block) as? TextBlock
    ?: return BookRange(BookPos(hit.chapter, hit.block, 0), BookPos(hit.chapter, hit.block, 1))
  val words = BreakIterator.getWordInstance(Locale.getDefault()).apply { setText(block.text) }
  val at = hit.offset.coerceIn(0, maxOf(0, block.text.length - 1))
  var start = words.preceding(at + 1).coerceAtLeast(0)
  var end = words.following(at).takeIf { it != BreakIterator.DONE } ?: block.text.length
  // A press between words takes the word before it, or the one after at a line's start.
  if (block.text.substring(start, end).isBlank()) {
    val before = if (start > 0 && !block.text[start - 1].isWhitespace()) words.preceding(start) else -1
    if (before >= 0) {
      end = start
      start = before
    } else {
      start = end
      end = words.following(end).takeIf { it != BreakIterator.DONE } ?: block.text.length
    }
  }
  if (start >= end) {
    start = at
    end = minOf(block.text.length, at + 1)
  }
  return BookRange(BookPos(hit.chapter, hit.block, start), BookPos(hit.chapter, hit.block, end))
}

/** Draws one page: its text, images and rules, with highlights, search matches and a selection. */
private fun DrawScope.drawPage(
  state: BookState,
  layout: BookLayout,
  style: BookStyle,
  page: BookPage,
  selection: BookRange?,
  handleRadius: Float
) {
  val dark = style.background.luminance() < 0.5f
  translate(layout.textLeft, layout.textTop) {
    page.items.forEach { item ->
      when (item) {
        is PlacedText -> drawTextItem(state, style, page.chapter, item, selection, dark)
        is PlacedImage -> state.image(item.path, item.width)?.let { image ->
          drawImage(
            image,
            dstOffset = IntOffset(item.left.toInt(), item.top.toInt()),
            dstSize = androidx.compose.ui.unit.IntSize(item.width.toInt(), item.height.toInt())
          )
        }
        is PlacedRule -> drawLine(
          style.foreground.copy(alpha = 0.4f),
          Offset(layout.textWidth * 0.375f, item.top + item.height / 2),
          Offset(layout.textWidth * 0.625f, item.top + item.height / 2),
          strokeWidth = 1.dp.toPx()
        )
      }
    }
  }
  if (selection != null) {
    handlePositions(page, layout, selection).forEachIndexed { index, point ->
      if (point != null) {
        val center = Offset(point.x + if (index == 0) -handleRadius * 0.6f else handleRadius * 0.6f, point.y + handleRadius)
        drawCircle(style.link, handleRadius, center)
        drawRect(style.link, Offset(if (index == 0) center.x else center.x - handleRadius, point.y), androidx.compose.ui.geometry.Size(handleRadius, handleRadius))
      }
    }
  }
}

private fun DrawScope.drawTextItem(
  state: BookState,
  style: BookStyle,
  chapter: Int,
  item: PlacedText,
  selection: BookRange?,
  dark: Boolean
) {
  translate(0f, item.top - item.layoutTop) {
    clipRect(left = -size.width, top = item.layoutTop, right = size.width * 2, bottom = item.layoutTop + item.height) {
      fun ranges(range: BookRange): IntRange? {
        if (range.start.chapter != chapter) return null
        val from = if (range.start.block < item.block) item.startOffset else if (range.start.block == item.block) range.start.offset else return null
        val to = if (range.end.block > item.block) item.endOffset else if (range.end.block == item.block) range.end.offset else return null
        val start = maxOf(from, item.startOffset)
        val end = minOf(to, item.endOffset)
        return if (start < end) start until end else null
      }
      state.marks.values.forEach { mark ->
        ranges(mark.range)?.let { span ->
          val fill = highlightFills[mark.color] ?: highlightFills.getValue("yellow")
          fillRange(item.layout, span, fill, if (dark) 0.35f else 0.55f, if (dark) BlendMode.SrcOver else BlendMode.Multiply)
        }
      }
      state.searchHits.forEach { hit ->
        ranges(hit)?.let { span ->
          fillRange(item.layout, span, style.link, 0.3f)
        }
      }
      state.placeMark?.let { mark ->
        ranges(mark)?.let { span -> fillRange(item.layout, span, style.link, 0.2f) }
      }
      if (selection != null) {
        ranges(selection)?.let { span -> fillRange(item.layout, span, style.link, 0.3f) }
      }
      drawText(item.layout)
    }
  }
}

/** How many words of the page's opening the app keeps, to find the place in the audiobook. */
private const val passageWords = 60

/** A word as matched between the audio and the text: lower case, letters and digits only. */
private fun matchWord(word: String) = word.lowercase().filter { it.isLetterOrDigit() }

/** The first words from a place on, across blocks and chapters, as one line of text. */
private fun passageAt(book: EpubBook, from: BookPos): String {
  val words = mutableListOf<String>()
  var chapter = from.chapter
  var block = from.block
  var offset = from.offset
  while (chapter < book.chapters.size && words.size < passageWords) {
    val blocks = book.chapters[chapter].blocks
    if (block >= blocks.size) {
      chapter++
      block = 0
      offset = 0
      continue
    }
    val text = (blocks[block] as? TextBlock)?.text
    if (text != null) {
      words.addAll(text.substring(offset.coerceIn(0, text.length)).split(Regex("\\s+")).filter { it.isNotBlank() })
    }
    block++
    offset = 0
  }
  return words.take(passageWords).joinToString(" ")
}

/**
 * Where heard words stand in the text near `fraction`: every run of three heard words found in the
 * chapters around it votes for how the heard words line up with the text, and the line-up most
 * runs agree on wins, the one nearest `fraction` among equals. The place is the last heard word,
 * where listening stopped, or with `atEnd` false the first.
 */
private fun findPassage(book: EpubBook, heard: List<String>, fraction: Float, atEnd: Boolean): BookPos? {
  val spoken = heard.map(::matchWord).filter { it.isNotEmpty() }
  if (spoken.size < 3) return null
  val middle = book.posAt(fraction).chapter
  val text = mutableListOf<String>()
  val places = mutableListOf<BookPos>()
  for (chapter in (middle - 1).coerceAtLeast(0)..(middle + 1).coerceAtMost(book.chapters.size - 1)) {
    book.chapters[chapter].blocks.forEachIndexed { blockIndex, block ->
      val words = (block as? TextBlock)?.text ?: return@forEachIndexed
      Regex("\\S+").findAll(words).forEach { match ->
        val word = matchWord(match.value)
        if (word.isNotEmpty()) {
          text.add(word)
          places.add(BookPos(chapter, blockIndex, match.range.first))
        }
      }
    }
  }
  if (text.size < 3) return null

  val runs = HashMap<String, MutableList<Int>>()
  for (index in 0..text.size - 3) {
    runs.getOrPut("${text[index]} ${text[index + 1]} ${text[index + 2]}") { mutableListOf() }.add(index)
  }
  val votes = HashMap<Int, Int>()
  for (index in 0..spoken.size - 3) {
    runs["${spoken[index]} ${spoken[index + 1]} ${spoken[index + 2]}"]?.forEach { at ->
      votes.merge(at - index, 1, Int::plus)
    }
  }
  val estimate = text.indices.minByOrNull { abs(book.fraction(places[it]) - fraction) } ?: 0
  val best = votes.entries
    .filter { it.value >= 2 }
    .maxWithOrNull(compareBy<Map.Entry<Int, Int>> { it.value }.thenByDescending { abs(it.key - estimate) })
    ?: return null
  val index = (best.key + if (atEnd) spoken.size - 1 else 0).coerceIn(0, text.size - 1)
  return places[index]
}
