import { describe, expect, it } from 'vitest'
import { parseSearchPage } from './parse'

// A result card in the shape Anna's Archive's search uses: the title link, an author link with a
// user icon, a publisher link and the facts line.
const card = `
<div class="flex pt-3 pb-3 border-b">
  <div id="list_cover_aarecord_id__md5:ed984db8707f12fe72ae28efa5f3f30f"><img src="https://covers.example/1.jpg"></div>
  <div class="max-w-full">
    <a href="/md5/ed984db8707f12fe72ae28efa5f3f30f" class="js-vim-focus font-semibold">Project Hail Mary</a>
    <a href="/search?q=Andy+Weir"><span class="icon-[mdi--user-edit]"></span> Andy Weir</a>
    <a href="/search?q=Random+House"><span class="icon-[mdi--company]"></span> Random House</a>
    <div class="font-semibold text-sm leading-[1.2]">English [en] · EPUB · 0.5MB · 2021 · 📘 Book (fiction)</div>
  </div>
</div>`

describe('Anna’s Archive search', () => {
  it('reads a result card', () => {
    const [file] = parseSearchPage(
      `<html><body>${card}${card}</body></html>`,
      'https://annas-archive.gl',
    )

    expect(file).toEqual({
      md5: 'ed984db8707f12fe72ae28efa5f3f30f',
      title: 'Project Hail Mary',
      authors: ['Andy Weir'],
      publisher: 'Random House',
      year: '2021',
      language: 'English',
      extension: 'epub',
      size: '0.5MB',
      coverUrl: 'https://covers.example/1.jpg',
    })
  })

  it('reads nothing from a page without results', () => {
    expect(
      parseSearchPage('<html><body><p>Checking your browser</p></body></html>', 'https://a'),
    ).toEqual([])
  })
})
