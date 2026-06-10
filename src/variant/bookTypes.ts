export interface TocSection {
  title: string
  page: number
}

export interface TocChapter {
  title: string
  page: number
  endPage: number
  sections: TocSection[]
}

export interface BookImageSize {
  width: number
  height: number
}

export interface BuiltInBook {
  id: string
  title: string
  shortTitle: string
  subtitle: string
  pageCount: number
  imageBasePath?: string
  coverSrc?: string
  toc: TocChapter[]
  imageSize: (pageNumber: number) => BookImageSize
  blankCanvas?: boolean
  importsEnabled?: boolean
}
