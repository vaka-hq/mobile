package expo.modules.androidcomponents

import org.xmlpull.v1.XmlPullParser

/** Runs of spaces, tabs and line breaks as one space, as a browser collapses them. */
internal fun collapseWhitespace(raw: String): String {
  val out = StringBuilder(raw.length)
  var space = false
  for (character in raw) {
    if (character == ' ' || character == '\t' || character == '\n' || character == '\r' || character == '\u000C') {
      if (!space) out.append(' ')
      space = true
    } else {
      out.append(character)
      space = false
    }
  }
  return out.toString()
}

// Compiled once: parsing runs them for every element and every run of text in the book.
private val whitespace = Regex("\\s+")
private val comments = Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL)
private val mediaBlocks = Regex("@media[^{]*\\{((?:[^{}]*\\{[^}]*\\})*)[^}]*\\}")
private val ruleBlocks = Regex("([^{}@]+)\\{([^}]*)\\}")
private val combinators = Regex("[\\s>+~]+")
private val fontFamilyDeclaration = Regex("font-family\\s*:\\s*([^;]+)", RegexOption.IGNORE_CASE)
private val signedNumber = Regex("^(-?[0-9.]+)")
private val unsignedNumber = Regex("^([0-9.]+)")

/** What the reader takes from a book's style sheets for one element. */
internal data class CssStyle(
  val italic: Boolean? = null,
  val bold: Boolean? = null,
  val smallCaps: Boolean? = null,
  val uppercase: Boolean? = null,
  val align: Align? = null,
  val indent: Float? = null,
  /** A first-line indent given as a share of the text's width, in percent. */
  val indentPercent: Float? = null,
  val size: Float? = null,
  val hidden: Boolean? = null,
  val marginTop: Float? = null,
  val marginBottom: Float? = null,
  /** The element's border is turned off, as books do to hide a rule they keep for structure. */
  val noBorder: Boolean? = null
) {
  fun over(base: CssStyle) = CssStyle(
    italic ?: base.italic,
    bold ?: base.bold,
    smallCaps ?: base.smallCaps,
    uppercase ?: base.uppercase,
    align ?: base.align,
    indent ?: base.indent,
    indentPercent ?: base.indentPercent,
    size ?: base.size,
    hidden ?: base.hidden,
    marginTop ?: base.marginTop,
    marginBottom ?: base.marginBottom,
    noBorder ?: base.noBorder
  )
}

/**
 * The little of CSS a reader needs: rules for a tag, a class or a tag with classes, the last part
 * of each selector only, applied tag first and classes after, later rules winning. Everything else,
 * fonts, colours, margins, is the reader's own.
 */
internal class Css {
  private class Rule(val tag: String?, val classes: List<String>, val style: CssStyle, val order: Int)

  private val rules = mutableListOf<Rule>()
  private val loaded = mutableSetOf<String>()

  /** The body text is set in a serif face, as the book's style sheets have it. */
  var serifBody = false
    private set

  fun load(path: String, read: (String) -> String?) {
    if (!loaded.add(path)) return
    read(path)?.let { parse(it) }
  }

  fun parse(sheet: String) {
    val text = sheet.replace(comments, "").replace(mediaBlocks, "$1")
    styles.clear()
    ruleBlocks.findAll(text).forEach { match ->
      val declarations = match.groupValues[2]
      val style = declarationsOf(declarations)
      match.groupValues[1].split(',').forEach { raw ->
        val selector = raw.trim().split(combinators).lastOrNull() ?: return@forEach
        // Rules for a part of an element or a state, such as a drop cap's `:first-letter` or
        // `:hover`, would restyle the whole element here, so they are left out.
        if (selector.isEmpty() || selector.contains(':') || selector.contains('[') || selector.contains('#')) return@forEach
        val parts = selector.split('.')
        val tag = parts[0].lowercase().takeIf { it.isNotEmpty() && it != "*" }
        val classes = parts.drop(1).filter { it.isNotEmpty() }
        if (tag == null && classes.isEmpty()) return@forEach
        rules.add(Rule(tag, classes, style, rules.size))
        if ((tag == "body" || tag == "html" || tag == "p") && classes.isEmpty()) {
          fontFamily(declarations)?.let { serifBody = it }
        }
      }
    }
  }

  // The same tag with the same classes styles the same way, so each pairing is worked out once.
  private val styles = HashMap<String, CssStyle>()

  fun styleOf(tag: String, classes: List<String>, inline: String?): CssStyle {
    val key = tag + "." + classes.joinToString(".")
    val sheetStyle = styles.getOrPut(key) {
      var style = CssStyle()
      rules
        .filter { rule -> (rule.tag == null || rule.tag == tag) && classes.containsAll(rule.classes) }
        .sortedWith(compareBy({ it.classes.size * 10 + if (it.tag != null) 1 else 0 }, { it.order }))
        .forEach { rule -> style = rule.style.over(style) }
      style
    }
    return if (inline != null) declarationsOf(inline).over(sheetStyle) else sheetStyle
  }

  private fun fontFamily(declarations: String): Boolean? {
    val value = fontFamilyDeclaration.find(declarations)
      ?.groupValues?.get(1)?.lowercase() ?: return null
    return when {
      value.contains("sans-serif") -> false
      value.contains("serif") || value.contains("times") || value.contains("georgia") ||
        value.contains("garamond") || value.contains("palatino") || value.contains("minion") -> true
      else -> null
    }
  }

  private fun declarationsOf(text: String): CssStyle {
    var style = CssStyle()
    text.split(';').forEach { declaration ->
      val name = declaration.substringBefore(':').trim().lowercase()
      val value = declaration.substringAfter(':', "").replace("!important", "").trim().lowercase()
      style = when (name) {
        "font-style" -> style.copy(italic = value == "italic" || value == "oblique")
        "font-weight" -> style.copy(bold = value == "bold" || value == "bolder" || (value.toIntOrNull() ?: 400) >= 600)
        "font-variant", "font-variant-caps" -> style.copy(smallCaps = value.contains("small-caps"))
        "text-transform" -> style.copy(uppercase = value == "uppercase")
        "text-align" -> style.copy(
          align = when (value) {
            "center" -> Align.Center
            "right", "end" -> Align.End
            "left", "start" -> Align.Start
            "justify" -> Align.Justify
            else -> style.align
          }
        )
        "text-indent" -> if (value.endsWith("%")) {
          style.copy(indentPercent = value.removeSuffix("%").toFloatOrNull(), indent = null)
        } else {
          style.copy(indent = length(value) ?: style.indent, indentPercent = null)
        }
        "font-size" -> style.copy(size = size(value) ?: style.size)
        "display" -> style.copy(hidden = value == "none")
        "border", "border-top", "border-style", "border-top-style", "border-width", "border-top-width" -> {
          val parts = value.split(whitespace)
          val off = parts.any { it == "none" || it == "hidden" } || parts.all { it == "0" || it == "0px" }
          style.copy(noBorder = off)
        }
        "margin-top" -> style.copy(marginTop = length(value) ?: style.marginTop)
        "margin-bottom" -> style.copy(marginBottom = length(value) ?: style.marginBottom)
        "margin" -> {
          val parts = value.split(whitespace)
          val top = parts.getOrNull(0)?.let { length(it) }
          val bottom = (if (parts.size >= 3) parts[2] else parts.getOrNull(0))?.let { length(it) }
          style.copy(marginTop = top ?: style.marginTop, marginBottom = bottom ?: style.marginBottom)
        }
        else -> style
      }
    }
    return style
  }

  /** A length in em: `1.2em`, `0`, `16px`, `5%` of a line. */
  private fun length(value: String): Float? {
    val number = signedNumber.find(value)?.groupValues?.get(1)?.toFloatOrNull() ?: return null
    return when {
      value.endsWith("px") -> number / 16f
      value.endsWith("pt") -> number / 12f
      value.endsWith("%") -> number / 100f * 2f
      else -> number
    }
  }

  private fun size(value: String): Float? {
    val named = mapOf(
      "xx-small" to 0.6f, "x-small" to 0.75f, "small" to 0.89f, "medium" to 1f,
      "large" to 1.2f, "x-large" to 1.5f, "xx-large" to 2f, "smaller" to 0.85f, "larger" to 1.2f
    )
    named[value]?.let { return it }
    val number = unsignedNumber.find(value)?.groupValues?.get(1)?.toFloatOrNull() ?: return null
    return when {
      value.endsWith("%") -> number / 100f
      value.endsWith("px") -> number / 16f
      value.endsWith("pt") -> number / 12f
      value.endsWith("em") || value.endsWith("rem") -> number
      else -> null
    }?.coerceIn(0.5f, 3f)
  }
}

private val blockTags = setOf(
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "pre", "figure",
  "figcaption", "dd", "dt", "section", "article", "header", "footer", "aside", "table", "tr",
  "ul", "ol", "dl", "main", "nav", "center", "address", "body", "caption", "hgroup"
)

private val skippedTags = setOf("head", "script", "style", "title", "template", "noscript")

/**
 * Turns one chapter's XHTML into blocks: each paragraph, heading, quote or list item becomes a
 * block of text with its runs of italic, bold, small caps, superscript and links; images and rules
 * are blocks of their own. Whitespace collapses as in a browser, and notes the book hides, such as
 * footnote asides, stay hidden.
 */
internal class ChapterParser(
  private val path: String,
  private val css: Css,
  private val read: (String) -> String?
) {
  private val base = path.substringBeforeLast('/', "")
  private val blocks = mutableListOf<Block>()
  private val anchors = mutableMapOf<String, Int>()

  private class Element(
    val tag: String,
    val style: CssStyle,
    val block: Boolean,
    val kind: BlockKind?,
    val level: Int,
    val href: String?,
    // Each of these holds for the element or anything around it, worked out once as it opens.
    val hidden: Boolean,
    val sup: Boolean,
    val sub: Boolean,
    val pre: Boolean,
    /** The closest block element around this one. */
    val around: Element?
  ) {
    /** The nearest block element: this one, or the closest around it. */
    val nearestBlock: Element? get() = if (block) this else around
  }

  private val stack = ArrayDeque<Element>()
  private val text = StringBuilder()
  private val spans = mutableListOf<Span>()
  // The block's own settings, taken from the elements around its first text.
  private var pendingKind = BlockKind.Paragraph
  private var pendingLevel = 0
  private var pendingStyle = CssStyle()
  private var pendingTag = "p"

  fun parse(html: String): EpubChapter {
    val parser = parser(html)
    try {
      while (parser.next() != XmlPullParser.END_DOCUMENT) {
        when (parser.eventType) {
          XmlPullParser.START_TAG -> start(parser)
          XmlPullParser.END_TAG -> end(parser)
          XmlPullParser.TEXT, XmlPullParser.ENTITY_REF -> parser.text?.let { append(it) }
        }
      }
    } catch (_: Exception) {
      // A malformed chapter keeps what was read before the fault.
    }
    flush()
    return EpubChapter(path, blocks.toList(), anchors.toMap())
  }

  private fun hidden() = stack.lastOrNull()?.hidden == true

  private fun start(parser: XmlPullParser) {
    val tag = local(parser.name).lowercase()
    val parent = stack.lastOrNull()

    if (tag == "link" && parser.attr("rel")?.contains("stylesheet") == true) {
      parser.attr("href")?.let { href -> css.load(resolvePath(base, href), read) }
    }
    if (tag == "style") {
      try {
        css.parse(parser.nextText())
      } catch (_: Exception) {
      }
      return
    }

    val classes = parser.attr("class")?.split(whitespace)?.filter { it.isNotEmpty() } ?: emptyList()
    val own = css.styleOf(tag, classes, parser.attr("style"))
    // Italic, bold, small caps, capitals and size carry down; alignment and indent belong to
    // blocks and carry into the blocks inside them.
    val inherited = CssStyle(
      italic = parent?.style?.italic,
      bold = parent?.style?.bold,
      smallCaps = parent?.style?.smallCaps,
      uppercase = parent?.style?.uppercase,
      align = parent?.style?.align,
      size = null
    )
    var style = own.over(inherited)
    val epubType = parser.attr("epub:type") ?: parser.attr("type") ?: ""
    val note = tag == "aside" && (epubType.contains("footnote") || epubType.contains("endnote") || epubType.contains("rearnote"))
    val hidden = tag in skippedTags || note || own.hidden == true
    when (tag) {
      "em", "i", "cite", "dfn", "var" -> if (own.italic == null) style = style.copy(italic = true)
      "strong", "b" -> if (own.bold == null) style = style.copy(bold = true)
      "h1", "h2", "h3", "h4", "h5", "h6" -> if (own.bold == null) style = style.copy(bold = true)
      "center" -> if (own.align == null) style = style.copy(align = Align.Center)
    }

    val kind = when (tag) {
      "h1", "h2", "h3", "h4", "h5", "h6" -> BlockKind.Heading
      "blockquote" -> BlockKind.Quote
      "li", "dd" -> BlockKind.ListItem
      "pre" -> BlockKind.Preformatted
      else -> parent?.kind
    }
    val level = if (kind == BlockKind.Heading && tag.startsWith("h")) tag.drop(1).toIntOrNull() ?: 1 else parent?.level ?: 0
    // A link within this document, such as to a footnote, is written with the document's own path.
    val href = if (tag == "a") parser.attr("href")?.let {
      when {
        it.contains("://") || it.startsWith("mailto:") -> it
        it.startsWith("#") -> "$path$it"
        else -> resolvePath(base, it)
      }
    } else null
    val block = tag in blockTags

    parser.attr("id")?.let { id -> anchors.putIfAbsent(id, blocks.size) }
    parser.attr("name")?.takeIf { tag == "a" }?.let { id -> anchors.putIfAbsent(id, blocks.size) }

    if (block) flush()

    stack.addLast(
      Element(
        tag, style, block, kind, level, href ?: parent?.href,
        hidden = hidden || parent?.hidden == true,
        sup = tag == "sup" || parent?.sup == true,
        sub = tag == "sub" || parent?.sub == true,
        pre = kind == BlockKind.Preformatted,
        around = parent?.nearestBlock
      )
    )

    if (hidden()) return
    when (tag) {
      "br" -> appendRaw("\n")
      "hr" -> {
        flush()
        // A rule whose border the book turns off is not drawn; its scene break is marked some
        // other way, such as a centred dash that follows it.
        if (own.noBorder != true) blocks.add(RuleBlock())
      }
      "img", "image" -> {
        val src = parser.attr("src") ?: parser.attr("xlink:href") ?: parser.attr("href")
        if (src != null && !src.startsWith("data:")) {
          flush()
          blocks.add(ImageBlock(resolvePath(base, src)))
        }
      }
    }
    // Self-closing elements end at once in the relaxed parser only sometimes; empty ones are
    // closed by their END_TAG, which pops them.
  }

  private fun end(parser: XmlPullParser) {
    val tag = local(parser.name).lowercase()
    if (tag == "style") return
    // Pop to the matching element, forgiving tags the book forgot to close.
    val index = stack.indexOfLast { it.tag == tag }
    if (index < 0) return
    while (stack.size > index) {
      val element = stack.removeLast()
      if (element.block) flush()
    }
    if (tag in setOf("td", "th") && text.isNotEmpty() && !text.endsWith(' ')) appendRaw(" ")
  }

  private fun append(raw: String) {
    if (hidden()) return
    val element = stack.lastOrNull()
    val pre = element?.pre == true
    var value = if (pre) raw else collapseWhitespace(raw)
    if (!pre && (text.isEmpty() || text.endsWith(' ') || text.endsWith('\n'))) value = value.trimStart(' ')
    if (value.isEmpty()) return
    val style = element?.style ?: CssStyle()
    if (style.uppercase == true) value = value.uppercase()
    if (text.isEmpty()) {
      // The block takes its kind and alignment from where its text begins.
      pendingKind = element?.kind ?: BlockKind.Paragraph
      pendingLevel = element?.level ?: 0
      val blockElement = element?.nearestBlock
      pendingStyle = blockElement?.style ?: style
      pendingTag = blockElement?.tag ?: "p"
    }
    val startAt = text.length
    text.append(value)
    spans.add(
      Span(
        startAt, text.length,
        italic = style.italic == true,
        bold = style.bold == true,
        smallCaps = style.smallCaps == true,
        superscript = element?.sup == true,
        subscript = element?.sub == true,
        href = element?.href,
        size = style.size ?: 1f
      )
    )
  }

  /** A browser's own spacing around an element, in em, when the book sets none. */
  private fun defaultMargin(tag: String): Float = when (tag) {
    "p", "blockquote", "figure", "dl", "ul", "ol", "pre" -> 1f
    "h1" -> 0.67f
    "h2" -> 0.83f
    "h3" -> 1f
    "h4" -> 1.33f
    "h5", "h6" -> 1.67f
    else -> 0f
  }

  private fun appendRaw(value: String) {
    if (text.isEmpty() && value == "\n") return
    val startAt = text.length
    text.append(value)
    spans.add(Span(startAt, text.length, false, false, false, false, false, null, 1f))
  }

  private fun flush() {
    // Trailing spaces and breaks go; a block of only whitespace is no block.
    var end = text.length
    while (end > 0 && (text[end - 1] == ' ' || text[end - 1] == '\n')) end--
    if (end > 0 && text.substring(0, end).isNotBlank()) {
      val content = text.substring(0, end)
      val kept = spans.mapNotNull { span ->
        if (span.start >= end) null
        else Span(span.start, minOf(span.end, end), span.italic, span.bold, span.smallCaps, span.superscript, span.subscript, span.href, span.size)
      }
      blocks.add(
        TextBlock(
          kind = pendingKind,
          level = pendingLevel,
          text = content,
          spans = kept,
          align = pendingStyle.align,
          indent = pendingStyle.indent,
          indentPercent = pendingStyle.indentPercent,
          size = pendingStyle.size ?: 1f,
          uppercase = pendingStyle.uppercase == true,
          marginTop = pendingStyle.marginTop ?: defaultMargin(pendingTag),
          marginBottom = pendingStyle.marginBottom ?: defaultMargin(pendingTag)
        )
      )
    }
    text.clear()
    spans.clear()
  }
}
