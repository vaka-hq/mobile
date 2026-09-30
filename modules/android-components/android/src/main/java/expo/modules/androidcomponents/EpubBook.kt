package expo.modules.androidcomponents

import android.util.Xml
import java.io.File
import java.net.URLDecoder
import java.util.zip.ZipFile
import org.xmlpull.v1.XmlPullParser

/**
 * An EPUB read into the reader's own model: the chapters in reading order as blocks of styled
 * text and images, the table of contents and the book's language. Only what Android ships is
 * used: the zip reader and the XML pull parser. The book's own styling is reduced to what reads
 * the same everywhere, italic, bold, small caps, headings, alignment and indents; the reader's
 * settings decide the rest.
 */
class EpubBook(
  val title: String?,
  val author: String?,
  val language: String?,
  val chapters: List<EpubChapter>,
  val toc: List<TocEntry>,
  /** The book's own font is a serif one, as its style sheets say. */
  val serif: Boolean,
  private val zip: ZipFile
) {
  /** Where each chapter starts, counted in characters from the start of the book. */
  val chapterStarts: IntArray
  val totalChars: Int

  init {
    val starts = IntArray(chapters.size)
    var sum = 0
    chapters.forEachIndexed { index, chapter ->
      starts[index] = sum
      sum += chapter.length
    }
    chapterStarts = starts
    totalChars = maxOf(1, sum)
  }

  fun bytes(path: String): ByteArray? = readEntry(zip, path, maxImageBytes)

  fun close() = zip.close()

  /** How far into the book a place is, from 0 to 1. */
  fun fraction(pos: BookPos): Float {
    val chapter = chapters.getOrNull(pos.chapter) ?: return 0f
    val start = chapterStarts[pos.chapter] + chapter.charStart(pos.block) + pos.offset
    return (start.toFloat() / totalChars).coerceIn(0f, 1f)
  }

  /** The place a share of the way into the book, at the start of its block. */
  fun posAt(fraction: Float): BookPos {
    val target = (fraction.coerceIn(0f, 1f) * totalChars).toInt()
    var chapter = chapterStarts.indexOfLast { it <= target }.coerceAtLeast(0)
    while (chapter < chapters.size - 1 && chapters[chapter].blocks.isEmpty()) chapter++
    val within = target - chapterStarts[chapter]
    val blocks = chapters[chapter].blocks
    var block = 0
    var offset = 0
    for (index in blocks.indices) {
      val start = chapters[chapter].charStart(index)
      if (start > within) break
      block = index
      offset = if (blocks[index] is TextBlock) (within - start).coerceIn(0, blocks[index].length) else 0
    }
    return BookPos(chapter, block, offset)
  }

  /** The chapter and block a link inside the book points to, such as an entry of the contents. */
  fun resolve(href: String): BookPos? {
    val path = href.substringBefore('#')
    val fragment = href.substringAfter('#', "")
    val chapter = chapters.indexOfFirst { it.path == path || it.path.endsWith("/$path") }
    if (chapter < 0) return null
    val block = if (fragment.isEmpty()) 0 else chapters[chapter].anchors[fragment] ?: 0
    return BookPos(chapter, block.coerceAtMost(maxOf(0, chapters[chapter].blocks.size - 1)), 0)
  }

  companion object {
    fun open(file: File): EpubBook {
      val zip = ZipFile(file)
      try {
        val reader = Reader(zip)
        val rootPath = reader.rootfile() ?: throw IllegalStateException("This file has no package document")
        return reader.book(rootPath)
      } catch (error: Throwable) {
        zip.close()
        throw error
      }
    }
  }

  private class ManifestItem(val href: String, val type: String, val properties: String)

  private class Reader(val zip: ZipFile) {
    // A leading byte-order mark is dropped, which the XML parser would otherwise refuse.
    fun text(path: String): String? =
      readEntry(zip, path, maxTextBytes)?.toString(Charsets.UTF_8)?.removePrefix("\uFEFF")

    fun rootfile(): String? {
      val xml = text("META-INF/container.xml") ?: return null
      val parser = parser(xml)
      while (parser.next() != XmlPullParser.END_DOCUMENT) {
        if (parser.eventType == XmlPullParser.START_TAG && local(parser.name) == "rootfile") {
          return parser.attr("full-path")
        }
      }
      return null
    }

    fun book(rootPath: String): EpubBook {
      val opf = text(rootPath) ?: throw IllegalStateException("The package document is missing")
      val base = rootPath.substringBeforeLast('/', "")
      val manifest = mutableMapOf<String, ManifestItem>()
      val spine = mutableListOf<String>()
      var tocId: String? = null
      var title: String? = null
      var author: String? = null
      var language: String? = null
      val parser = parser(opf)
      var inMetadata = false
      while (parser.next() != XmlPullParser.END_DOCUMENT) {
        when (parser.eventType) {
          XmlPullParser.START_TAG -> when (local(parser.name)) {
            "metadata" -> inMetadata = true
            "title" -> if (inMetadata && title == null) title = parser.nextText().trim()
            "creator" -> if (inMetadata && author == null) author = parser.nextText().trim()
            "language" -> if (inMetadata && language == null) language = parser.nextText().trim()
            "item" -> {
              val id = parser.attr("id")
              val href = parser.attr("href")
              if (id != null && href != null) {
                manifest[id] = ManifestItem(
                  resolvePath(base, href),
                  parser.attr("media-type") ?: "",
                  parser.attr("properties") ?: ""
                )
              }
            }
            "spine" -> tocId = parser.attr("toc")
            "itemref" -> {
              val idref = parser.attr("idref")
              if (idref != null && parser.attr("linear") != "no") spine.add(idref)
            }
          }
          XmlPullParser.END_TAG -> if (local(parser.name) == "metadata") inMetadata = false
        }
      }

      val styles = Css()
      val chapters = spine.mapNotNull { id ->
        val item = manifest[id] ?: return@mapNotNull null
        if (!item.type.contains("html") && !item.href.endsWith("html") && !item.href.endsWith(".htm")) {
          return@mapNotNull null
        }
        val html = text(item.href) ?: return@mapNotNull null
        ChapterParser(item.href, styles) { path -> text(path) }.parse(html)
      }

      // A contents document that cannot be read leaves the book without contents, not unreadable.
      val navItem = manifest.values.firstOrNull { it.properties.split(' ').contains("nav") }
      val toc = navItem?.let { item -> text(item.href)?.let { runCatching { navToc(item.href, it) }.getOrNull() } }
        ?.takeIf { it.isNotEmpty() }
        ?: (tocId?.let { manifest[it] } ?: manifest.values.firstOrNull { it.type == "application/x-dtbncx+xml" })
          ?.let { item -> text(item.href)?.let { runCatching { ncxToc(item.href, it) }.getOrNull() } }
        ?: emptyList()

      return EpubBook(title, author, language, chapters, toc, styles.serifBody, zip)
    }

    /** The contents from an EPUB 3 navigation document: its `toc` nav, nested lists of links. */
    fun navToc(path: String, xml: String): List<TocEntry> {
      val base = path.substringBeforeLast('/', "")
      val entries = mutableListOf<TocEntry>()
      val parser = parser(xml)
      var inToc = false
      var depth = -1
      var href: String? = null
      val label = StringBuilder()
      // The element an entry's label began on, which alone ends it: a link may hold spans.
      var linkTag: String? = null
      while (parser.next() != XmlPullParser.END_DOCUMENT) {
        when (parser.eventType) {
          XmlPullParser.START_TAG -> when (local(parser.name)) {
            "nav" -> {
              val type = parser.attr("epub:type") ?: parser.attr("type") ?: ""
              if (type.split(' ').contains("toc")) inToc = true
            }
            "ol" -> if (inToc) depth++
            "a", "span" -> if (inToc && linkTag == null) {
              linkTag = local(parser.name)
              href = parser.attr("href")?.let { resolvePath(base, it) }
              label.clear()
            }
          }
          XmlPullParser.TEXT -> if (linkTag != null) label.append(parser.text)
          XmlPullParser.END_TAG -> when (local(parser.name)) {
            "nav" -> inToc = false
            "ol" -> if (inToc) depth--
            "a", "span" -> if (linkTag == local(parser.name)) {
              linkTag = null
              val text = label.toString().replace(tocWhitespace, " ").trim()
              if (text.isNotEmpty() && href != null) entries.add(TocEntry(text, href!!, maxOf(0, depth)))
            }
          }
        }
      }
      return entries
    }

    /** The contents from an EPUB 2 NCX: nested nav points, each a label and a link. */
    fun ncxToc(path: String, xml: String): List<TocEntry> {
      val base = path.substringBeforeLast('/', "")
      val entries = mutableListOf<TocEntry>()
      val parser = parser(xml)
      var depth = -1
      var label: String? = null
      while (parser.next() != XmlPullParser.END_DOCUMENT) {
        when (parser.eventType) {
          XmlPullParser.START_TAG -> when (local(parser.name)) {
            "navPoint" -> {
              depth++
              label = null
            }
            "text" -> if (depth >= 0 && label == null) label = parser.nextText().replace(tocWhitespace, " ").trim()
            "content" -> {
              val src = parser.attr("src")
              if (src != null && label != null) {
                entries.add(TocEntry(label!!, resolvePath(base, src), depth))
              }
            }
          }
          XmlPullParser.END_TAG -> if (local(parser.name) == "navPoint") depth--
        }
      }
      return entries
    }
  }
}

private val tocWhitespace = Regex("\\s+")

class TocEntry(val label: String, val href: String, val depth: Int)

/** The largest document and image the reader reads from a book, against broken or hostile files. */
private const val maxTextBytes = 16L * 1024 * 1024
private const val maxImageBytes = 32L * 1024 * 1024

/** An entry of the book's zip, or null when it is missing or larger than allowed. */
private fun readEntry(zip: ZipFile, path: String, limit: Long): ByteArray? {
  val entry = zip.getEntry(path) ?: return null
  if (entry.size > limit) return null
  return zip.getInputStream(entry).use { input ->
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      total += read
      // The declared size can lie; the bytes actually read are counted too.
      if (total > limit) return null
      out.write(buffer, 0, read)
    }
    out.toByteArray()
  }
}

/** A place in the book: a chapter, a block in it and a character in that block. */
data class BookPos(val chapter: Int, val block: Int, val offset: Int) : Comparable<BookPos> {
  override fun compareTo(other: BookPos): Int =
    compareValuesBy(this, other, { it.chapter }, { it.block }, { it.offset })

  /** Written as `vaka:chapter/block/offset`, the reader's own locator. */
  fun encode() = "$SCHEME$chapter/$block/$offset"

  companion object {
    const val SCHEME = "vaka:"

    fun decode(value: String): BookPos? {
      if (!value.startsWith(SCHEME)) return null
      val parts = value.removePrefix(SCHEME).substringBefore('-').split('/')
      if (parts.size != 3) return null
      return BookPos(parts[0].toIntOrNull() ?: return null, parts[1].toIntOrNull() ?: return null, parts[2].toIntOrNull() ?: return null)
    }
  }
}

/** A stretch of text between two places in one chapter, written as `vaka:c/b/o-b/o`. */
data class BookRange(val start: BookPos, val end: BookPos) {
  fun encode() = "${start.encode()}-${end.block}/${end.offset}"

  operator fun contains(pos: BookPos) = pos >= start && pos < end

  companion object {
    fun decode(value: String): BookRange? {
      val start = BookPos.decode(value) ?: return null
      val tail = value.substringAfter('-', "").split('/')
      if (tail.size != 2) return null
      val end = BookPos(start.chapter, tail[0].toIntOrNull() ?: return null, tail[1].toIntOrNull() ?: return null)
      return BookRange(start, end)
    }
  }
}

class EpubChapter(val path: String, val blocks: List<Block>, val anchors: Map<String, Int>) {
  private val starts: IntArray = IntArray(blocks.size).also { starts ->
    var sum = 0
    blocks.forEachIndexed { index, block ->
      starts[index] = sum
      sum += block.length
    }
  }

  val length: Int = blocks.sumOf { it.length }

  fun charStart(block: Int): Int = if (block in starts.indices) starts[block] else length
}

sealed class Block {
  abstract val length: Int
}

enum class BlockKind { Paragraph, Heading, Quote, ListItem, Preformatted }

enum class Align { Start, Center, End, Justify }

/** A run of text styled one way. */
class Span(
  val start: Int,
  val end: Int,
  val italic: Boolean,
  val bold: Boolean,
  val smallCaps: Boolean,
  val superscript: Boolean,
  val subscript: Boolean,
  val href: String?,
  val size: Float
)

class TextBlock(
  val kind: BlockKind,
  val level: Int,
  val text: String,
  val spans: List<Span>,
  val align: Align?,
  /** The first line's indent in em, as the book's style sheet sets it, or null for the default. */
  val indent: Float?,
  /** The first line's indent as a share of the text's width, in percent, when set that way. */
  val indentPercent: Float?,
  /** Text size relative to the body's, from the book's style sheet. */
  val size: Float,
  val uppercase: Boolean,
  /** Space above and below, in em of the block's text, collapsing with its neighbours'. */
  val marginTop: Float,
  val marginBottom: Float
) : Block() {
  override val length: Int get() = text.length
}

class ImageBlock(val path: String) : Block() {
  // An image counts as one character, so places and progress can step over it.
  override val length: Int get() = 1
}

class RuleBlock : Block() {
  override val length: Int get() = 1
}

internal fun local(name: String?): String = name?.substringAfter(':') ?: ""

internal fun XmlPullParser.attr(name: String): String? {
  for (index in 0 until attributeCount) {
    val attribute = getAttributeName(index)
    if (attribute == name || local(attribute) == name) return getAttributeValue(index)
  }
  return null
}

/** Joins a link to the folder of the document it is in, as a path inside the zip. */
internal fun resolvePath(base: String, href: String): String {
  val decoded = try {
    URLDecoder.decode(href.substringBefore('#').replace("+", "%2B"), "UTF-8")
  } catch (_: Exception) {
    href.substringBefore('#')
  }
  val fragment = href.substringAfter('#', "")
  if (decoded.isEmpty()) return if (fragment.isEmpty()) base else "#$fragment"
  val parts = ArrayDeque<String>()
  if (!decoded.startsWith("/")) base.split('/').filter { it.isNotEmpty() }.forEach { parts.addLast(it) }
  decoded.split('/').forEach { part ->
    when (part) {
      "", "." -> Unit
      ".." -> parts.removeLastOrNull()
      else -> parts.addLast(part)
    }
  }
  val path = parts.joinToString("/")
  return if (fragment.isEmpty()) path else "$path#$fragment"
}

private val entities = mapOf(
  "nbsp" to " ", "mdash" to "—", "ndash" to "–", "hellip" to "…",
  "lsquo" to "‘", "rsquo" to "’", "ldquo" to "“", "rdquo" to "”",
  "laquo" to "«", "raquo" to "»", "copy" to "©", "reg" to "®",
  "trade" to "™", "shy" to "­", "thinsp" to " ", "ensp" to " ",
  "emsp" to " ", "bull" to "•", "middot" to "·", "times" to "×",
  "deg" to "°", "eacute" to "é", "egrave" to "è", "aacute" to "á",
  "agrave" to "à", "ouml" to "ö", "auml" to "ä", "aring" to "å",
  "uuml" to "ü", "iacute" to "í", "oacute" to "ó", "uacute" to "ú",
  "ntilde" to "ñ", "ccedil" to "ç", "szlig" to "ß", "euro" to "€",
  "pound" to "£", "sect" to "§", "para" to "¶", "dagger" to "†",
  "Dagger" to "‡", "prime" to "′", "Prime" to "″", "zwnj" to "‌",
  "zwj" to "‍", "iexcl" to "¡", "iquest" to "¿"
)

/** A forgiving parser: books are often XHTML in name only. */
internal fun parser(xml: String): XmlPullParser {
  val parser = Xml.newPullParser()
  try {
    parser.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true)
  } catch (_: Exception) {
  }
  parser.setInput(xml.reader())
  for ((name, value) in entities) {
    try {
      parser.defineEntityReplacementText(name, value)
    } catch (_: Exception) {
    }
  }
  return parser
}
