import type { BuiltInBook } from './variant/bookTypes'
import { practice110Toc } from './practice110Toc'
import { textbookToc } from './toc'
export type { BookImageSize, BuiltInBook, TocChapter, TocSection } from './variant/bookTypes'

const textbookImageSize = () => ({ width: 1440, height: 2048 })
const exerciseImageSize = () => ({ width: 1200, height: 1700 })

export const builtInBooks: BuiltInBook[] = [
  {
    id: 'textbook-main',
    title: '\u6b65\u6b65\u9ad8\u6570\u5b66\u590d\u4e60\u8bb2\u4e49',
    shortTitle: '\u6559\u6750',
    subtitle: '\u672c\u5730\u6559\u6750\u5305',
    pageCount: 260,
    imageSize: textbookImageSize,
    coverSrc: '/book/001.jpg',
    imageBasePath: '/book',
    toc: textbookToc,
    importsEnabled: true,
  },
  {
    id: 'textbook-110',
    title: '\u4e00\u8f6e\u590d\u4e60110\u7ec3',
    shortTitle: '\u4e00\u8f6e\u590d\u4e60110\u7ec3',
    subtitle: '\u672c\u5730\u6559\u6750\u5305',
    pageCount: 212,
    imageSize: exerciseImageSize,
    coverSrc: '/book-110/001.jpg',
    imageBasePath: '/book-110',
    toc: practice110Toc,
    importsEnabled: true,
  },
]

export const DEFAULT_BOOK_ID = 'textbook-main'

export const getBuiltInBook = (bookId: string | null | undefined) =>
  builtInBooks.find((book) => book.id === bookId) ??
  builtInBooks.find((book) => book.id === DEFAULT_BOOK_ID) ??
  builtInBooks[0]
