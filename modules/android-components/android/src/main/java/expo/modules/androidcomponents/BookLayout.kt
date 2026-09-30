package expo.modules.androidcomponents

import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.TextUnitType
import androidx.compose.ui.unit.em
import org.json.JSONObject

/**
 * Where each line of a justified paragraph ends before Android stretches it, hyphen included.
 * Android reports character positions on justified lines as if they were not stretched, so these
 * ends give how much the spaces of each line are widened when drawn.
 */
// Chapters are counted on several threads at once, so the map is synchronised.
val naturalEnds: MutableMap<TextLayoutResult, FloatArray> =
  java.util.Collections.synchronizedMap(java.util.WeakHashMap())

/** How the book is set, from the reader's settings and theme. */
data class BookStyle(
  /** Text size in percent of 16 dp. */
  val fontSize: Float,
  val lineHeight: Float,
  val fontFamily: String,
  val justify: Boolean,
  /** Space above the text on each page, in dp. */
  val margin: Float,
  /** Space below the text on each page, in dp. */
  val marginBottom: Float,
  /** The side margin as a share of the page width, in percent. */
  val gap: Float,
  val background: Color,
  val foreground: Color,
  val link: Color
) {
  /** The settings that move text on the page; colours change nothing about where it falls. */
  // `true` stands where the paged layout was told from the scrolling one, now gone, so the page
  // counts already kept for a book are still found.
  fun layoutKey() = listOf(fontSize, lineHeight, fontFamily, justify, true, margin, marginBottom, gap).joinToString("/")

  companion object {
    fun from(json: JSONObject) = BookStyle(
      fontSize = json.optDouble("fontSize", 100.0).toFloat(),
      lineHeight = json.optDouble("lineHeight", 1.5).toFloat(),
      fontFamily = json.optString("fontFamily", "publisher"),
      justify = json.optBoolean("justify", true),
      margin = json.optDouble("margin", 36.0).toFloat(),
      marginBottom = json.optDouble("marginBottom", json.optDouble("margin", 36.0)).toFloat(),
      gap = json.optDouble("gap", 6.0).toFloat(),
      background = parseColor(json.optString("background"), Color.White),
      foreground = parseColor(json.optString("foreground"), Color.Black),
      link = parseColor(json.optString("link"), Color.Blue)
    )

    /**
     * A colour as the app sends it: `#RRGGBB`, or `#RRGGBBAA` as CSS and Expo UI's Material
     * palette write it. Android reads eight digits as `#AARRGGBB`, so the alpha moves first.
     */
    fun parseColor(value: String?, fallback: Color): Color = try {
      val hex = value?.trim() ?: ""
      val argb = if (hex.length == 9 && hex.startsWith("#")) "#" + hex.substring(7, 9) + hex.substring(1, 7) else hex
      Color(android.graphics.Color.parseColor(argb))
    } catch (_: Exception) {
      fallback
    }
  }
}

/** One thing drawn on a page, placed from the top of the page's text area. */
sealed class Placed {
  abstract val block: Int
  abstract val top: Float
  abstract val height: Float
}

/** Some lines of a block of text: its whole layout, drawn only between these lines. */
class PlacedText(
  override val block: Int,
  val layout: TextLayoutResult,
  val lineStart: Int,
  val lineEnd: Int,
  override val top: Float
) : Placed() {
  val layoutTop: Float = layout.getLineTop(lineStart)
  override val height: Float = layout.getLineBottom(lineEnd - 1) - layoutTop
  val startOffset: Int = layout.getLineStart(lineStart)
  val endOffset: Int = layout.getLineEnd(lineEnd - 1)
}

class PlacedImage(
  override val block: Int,
  val path: String,
  val left: Float,
  val width: Float,
  override val top: Float,
  override val height: Float
) : Placed()

class PlacedRule(override val block: Int, override val top: Float, override val height: Float) : Placed()

class BookPage(val chapter: Int, val items: List<Placed>) {
  val start: BookPos = items.firstOrNull()?.let { BookPos(chapter, it.block, (it as? PlacedText)?.startOffset ?: 0) }
    ?: BookPos(chapter, 0, 0)
}

class ChapterPages(val chapter: Int, val pages: List<BookPage>) {
  /** The page a place falls on. */
  fun pageOf(pos: BookPos): Int {
    var found = 0
    pages.forEachIndexed { index, page -> if (page.start <= pos) found = index }
    return found
  }
}

/**
 * Lays out a book at one text size and page size: each block becomes a styled paragraph measured
 * with Compose's text layout, justified and hyphenated in the book's language, and chapters are
 * split into pages line by line, keeping headings with the text after them. Measuring needs no
 * main thread, so chapters are laid out in the background.
 */
class BookLayout(
  val book: EpubBook,
  val style: BookStyle,
  private val measurer: TextMeasurer,
  private val density: Density,
  /** The page in pixels. */
  val pageWidth: Int,
  val pageHeight: Int,
  /**
   * Keeps what placing a finger on justified text needs. Off when chapters are only laid out to
   * count their pages, which then goes faster.
   */
  private val forReading: Boolean = true
) {
  private val px = density.density
  private val basePx = 16f * style.fontSize / 100f * px

  /** The text column: side margins as a share of the page, and never wider than 720 dp. */
  val textWidth: Int = run {
    val side = pageWidth * style.gap / 100f
    minOf((pageWidth - 2 * side).toInt(), (720 * px).toInt()).coerceAtLeast(1)
  }
  val textLeft: Float = (pageWidth - textWidth) / 2f
  /**
   * The text column's height: a whole number of body lines, so a page full of text ends as far
   * from the bottom as it starts from the top, rather than leaving the part of a line that does not
   * fit below the last one. What is left over goes half above the text and half below.
   */
  val textHeight: Float by lazy {
    val room = (pageHeight - style.margin * px - style.marginBottom * px).coerceAtLeast(basePx * 4)
    val step = bodyLineStep()
    // Half a pixel spare, so rounding never leaves the last line off.
    if (step <= 0f) room else minOf(room, maxOf(kotlin.math.floor(room / step) * step + 0.5f, basePx * 4))
  }

  /** Where the text column starts, below the top margin and half of what is left over. */
  val textTop: Float by lazy {
    val room = (pageHeight - style.margin * px - style.marginBottom * px).coerceAtLeast(basePx * 4)
    style.margin * px + (room - textHeight) / 2f
  }

  /** How far apart lines of body text fall, as laid out, in pixels. */
  private fun bodyLineStep(): Float {
    val sample = TextBlock(
      kind = BlockKind.Paragraph,
      level = 0,
      text = "Ag\nAg\nAg",
      spans = emptyList(),
      align = Align.Start,
      indent = null,
      indentPercent = null,
      size = 1f,
      uppercase = false,
      marginTop = 0f,
      marginBottom = 0f
    )
    val layout = measure(sample)
    return if (layout.lineCount >= 3) (layout.getLineTop(2) - layout.getLineTop(0)) / 2f else 0f
  }

  private val family: FontFamily = when (style.fontFamily) {
    "serif" -> FontFamily.Serif
    "sans" -> FontFamily.SansSerif
    else -> if (book.serif) FontFamily.Serif else FontFamily.Default
  }

  private val locale = book.language?.let { runCatching { LocaleList(it) }.getOrNull() }

  private val imageSizes = mutableMapOf<String, Pair<Int, Int>>()

  private val charWidths = mutableMapOf<Pair<String, Float>, Float>()

  /** A character's width in a paragraph's type, measured once. */
  private fun charWidth(character: String, textStyle: TextStyle): Float =
    charWidths.getOrPut(character to textStyle.fontSize.value) {
      measurer.measure(character, textStyle.copy(textIndent = null), density = density).size.width.toFloat()
    }

  /** Sizes in sp that keep the book's dp sizes whatever the phone's text scale. */
  private fun sp(pixels: Float) = TextUnit(pixels / px / density.fontScale, TextUnitType.Sp)

  fun measure(block: TextBlock): TextLayoutResult {
    val headingScale = when {
      block.kind != BlockKind.Heading -> 1f
      block.level <= 1 -> 1.5f
      block.level == 2 -> 1.35f
      block.level == 3 -> 1.2f
      else -> 1.1f
    }
    val size = basePx * block.size * headingScale
    val align = when (block.align) {
      Align.Center -> TextAlign.Center
      Align.End -> TextAlign.End
      else -> if (block.kind == BlockKind.Heading) TextAlign.Start else if (style.justify) TextAlign.Justify else TextAlign.Start
    }
    val text = AnnotatedString.Builder(block.text).apply {
      block.spans.forEach { span ->
        // Plain text needs no style of its own; spans that change nothing only slow measuring.
        if (!span.italic && !span.bold && !span.smallCaps && !span.superscript && !span.subscript &&
          span.href == null && span.size == block.size
        ) {
          return@forEach
        }
        val relative = if (span.size != block.size) span.size else 1f
        addStyle(
          SpanStyle(
            fontStyle = if (span.italic) FontStyle.Italic else null,
            fontWeight = if (span.bold) FontWeight.Bold else null,
            fontFeatureSettings = if (span.smallCaps) "smcp, c2sc" else null,
            baselineShift = when {
              span.superscript -> BaselineShift.Superscript
              span.subscript -> BaselineShift.Subscript
              else -> null
            },
            fontSize = when {
              span.superscript || span.subscript -> sp(size * 0.75f)
              relative != 1f -> sp(size * relative)
              else -> TextUnit.Unspecified
            },
            color = if (span.href != null) style.link else Color.Unspecified,
            textDecoration = if (span.href != null && span.href.contains("://")) TextDecoration.Underline else null
          ),
          span.start,
          span.end
        )
      }
    }.toAnnotatedString()
    val textStyle =
      TextStyle(
        color = style.foreground,
        fontSize = sp(size),
        fontFamily = family,
        lineHeight = (if (block.kind == BlockKind.Heading) 1.25f else style.lineHeight).em,
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
        textAlign = align,
        textIndent = when {
          block.indentPercent != null && block.indentPercent != 0f ->
            TextIndent(firstLine = sp(textWidth * block.indentPercent / 100f))
          block.indent != null && block.indent != 0f -> TextIndent(firstLine = block.indent.em)
          else -> null
        },
        hyphens = Hyphens.Auto,
        lineBreak = LineBreak.Paragraph,
        localeList = locale
      )
    // The paragraph always takes the text's full width, so a short centred or right-aligned line,
    // such as a scene break's dash, sits where the book puts it rather than at the start.
    val result = measurer.measure(text, textStyle, constraints = Constraints.fixedWidth(textWidth), density = density)
    if (forReading && align == TextAlign.Justify) {
      val raw = block.text
      naturalEnds[result] = FloatArray(result.lineCount) { line ->
        val start = result.getLineStart(line)
        val end = result.getLineEnd(line, visibleEnd = true)
        if (end <= start) {
          0f
        } else {
          val last = end - 1
          val hyphenated = end < raw.length && raw[last].isLetterOrDigit() && raw[end].isLetterOrDigit()
          result.getHorizontalPosition(last, usePrimaryDirection = true) +
            charWidth(raw[last].toString(), textStyle) +
            if (hyphenated) charWidth("-", textStyle) else 0f
        }
      }
    }
    return result
  }

  /** The space above a block, collapsing with the one below the block before, in pixels. */
  fun spacing(previous: Block?, block: Block): Float {
    val before = when (block) {
      is TextBlock -> block.marginTop * basePx * block.size
      is ImageBlock, is RuleBlock -> basePx * 0.8f
    }
    val after = when (previous) {
      is TextBlock -> previous.marginBottom * basePx * previous.size
      is ImageBlock, is RuleBlock -> basePx * 0.8f
      null -> 0f
    }
    return maxOf(before, after)
  }

  /** An image at its own size, never wider than the text nor taller than the page. */
  fun imageSize(path: String): Pair<Float, Float> {
    val (width, height) = imageSizes.getOrPut(path) {
      val bytes = book.bytes(path)
      if (bytes == null) {
        0 to 0
      } else {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        options.outWidth to options.outHeight
      }
    }
    if (width <= 0 || height <= 0) return 0f to 0f
    // CSS pixels are dp, as a browser shows them.
    var w = minOf(width * px, textWidth.toFloat())
    var h = w * height / width
    if (h > textHeight) {
      h = textHeight
      w = h * width / height
    }
    return w to h
  }

  val ruleHeight: Float get() = basePx

  /** Splits a chapter into pages. */
  fun paginate(chapter: Int): ChapterPages {
    val blocks = book.chapters[chapter].blocks
    val pages = mutableListOf<BookPage>()
    var items = mutableListOf<Placed>()
    var y = 0f
    var previous: Block? = null

    fun newPage() {
      if (items.isNotEmpty()) pages.add(BookPage(chapter, items))
      items = mutableListOf()
      y = 0f
    }

    blocks.forEachIndexed { index, block ->
      val gap = if (items.isEmpty()) 0f else spacing(previous, block)
      when (block) {
        is ImageBlock -> {
          val (w, h) = imageSize(block.path)
          if (h > 0f) {
            if (items.isNotEmpty() && y + gap + h > textHeight) newPage()
            val top = if (items.isEmpty()) 0f else y + gap
            items.add(PlacedImage(index, block.path, (textWidth - w) / 2f, w, top, h))
            y = top + h
          }
        }
        is RuleBlock -> {
          if (items.isNotEmpty() && y + gap + ruleHeight > textHeight) newPage()
          val top = if (items.isEmpty()) 0f else y + gap
          items.add(PlacedRule(index, top, ruleHeight))
          y = top + ruleHeight
        }
        is TextBlock -> {
          val layout = measure(block)
          val lineHeight = if (layout.lineCount > 0) layout.getLineBottom(0) - layout.getLineTop(0) else basePx
          // A heading never ends a page: it moves on with room for its text below.
          if (block.kind == BlockKind.Heading && items.isNotEmpty() &&
            y + gap + layout.size.height + 2 * lineHeight * style.lineHeight > textHeight
          ) {
            newPage()
          }
          var top = if (items.isEmpty()) 0f else y + gap
          var line = 0
          while (line < layout.lineCount) {
            var end = line
            val startTop = layout.getLineTop(line)
            while (end < layout.lineCount && top + layout.getLineBottom(end) - startTop <= textHeight) end++
            if (end == line) {
              if (items.isEmpty()) {
                end = line + 1
              } else {
                newPage()
                top = 0f
                continue
              }
            }
            // A paragraph never leaves its first line alone at the foot of a page.
            if (line == 0 && end == 1 && layout.lineCount > 2 && items.isNotEmpty()) {
              newPage()
              top = 0f
              continue
            }
            // Nor its last line alone at the top of the next.
            if (end == layout.lineCount - 1 && end - line > 2) end--
            val placed = PlacedText(index, layout, line, end, top)
            items.add(placed)
            y = top + placed.height
            line = end
            if (line < layout.lineCount) {
              newPage()
              top = 0f
            }
          }
        }
      }
      previous = block
    }
    newPage()
    if (pages.isEmpty()) pages.add(BookPage(chapter, emptyList()))
    return ChapterPages(chapter, pages)
  }
}

