import type { BuiltInBook } from './variant/bookTypes'
export type { BookImageSize, BuiltInBook, TocChapter, TocSection } from './variant/bookTypes'

export const DEFAULT_BOOK_ID = 'blank'

export const builtInBooks: BuiltInBook[] = [
  {
    id: DEFAULT_BOOK_ID,
    title: '纯白画布',
    shortTitle: '纯白画布',
    subtitle: '本地白板',
    pageCount: 1,
    toc: [],
    imageSize: () => ({ width: 1920, height: 1080 }),
    blankCanvas: true,
    importsEnabled: false,
  },
]

export const getBuiltInBook = (bookId: string | null | undefined) =>
  builtInBooks.find((book) => book.id === bookId) ?? builtInBooks[0]
