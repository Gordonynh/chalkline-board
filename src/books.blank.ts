import type { BuiltInBook } from './variant/bookTypes'
export type { BookImageSize, BuiltInBook, TocChapter, TocSection } from './variant/bookTypes'

export const DEFAULT_BOOK_ID = 'blank'

export const builtInBooks: BuiltInBook[] = [
  {
    id: DEFAULT_BOOK_ID,
    title: '\u7eaf\u767d\u753b\u5e03',
    shortTitle: '\u7eaf\u767d\u753b\u5e03',
    subtitle: '\u672c\u5730\u767d\u677f',
    pageCount: 1,
    toc: [],
    imageSize: () => ({ width: 1920, height: 1080 }),
    blankCanvas: true,
    importsEnabled: true,
  },
]

export const getBuiltInBook = (bookId: string | null | undefined) =>
  builtInBooks.find((book) => book.id === bookId) ?? builtInBooks[0]
