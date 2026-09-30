import { describe, expect, it } from 'vitest'
import { splitTitle } from './display'

describe('book titles', () => {
  it('drops a subtitle that the title already ends with', () => {
    expect(
      splitTitle(
        'Atomic habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones',
        'An Easy & Proven Way to Build Good Habits & Break Bad Ones',
      ),
    ).toEqual({
      title: 'Atomic habits',
      subtitle: 'An Easy & Proven Way to Build Good Habits & Break Bad Ones',
    })
  })

  it('keeps separate titles and subtitles as they are', () => {
    expect(splitTitle('Project Hail Mary', 'A Novel')).toEqual({
      title: 'Project Hail Mary',
      subtitle: 'A Novel',
    })
    expect(splitTitle('Dune', null)).toEqual({ title: 'Dune', subtitle: null })
    expect(splitTitle('Dune', 'Dune')).toEqual({ title: 'Dune', subtitle: null })
  })
})
