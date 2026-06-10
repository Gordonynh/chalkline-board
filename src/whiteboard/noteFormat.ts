import type { BoardProject } from './core'

const NOTE_FORMAT_ID = 'open-whiteboard.note'
const NOTE_FORMAT_VERSION = 1
const NOTE_EXTENSION = 'owbn'
const NOTE_MIME_TYPE = 'application/vnd.open-whiteboard.note+json'

interface OpenWhiteboardNoteFile {
  format: typeof NOTE_FORMAT_ID
  version: typeof NOTE_FORMAT_VERSION
  app: 'ClearBoard Studio'
  createdAt: string
  project: BoardProject
}

function createNoteFile(project: BoardProject): OpenWhiteboardNoteFile {
  return {
    format: NOTE_FORMAT_ID,
    version: NOTE_FORMAT_VERSION,
    app: 'ClearBoard Studio',
    createdAt: new Date().toISOString(),
    project,
  }
}

function serializeNoteFile(project: BoardProject) {
  return JSON.stringify(createNoteFile(project), null, 2)
}

function parseNoteFileText(text: string): BoardProject {
  const parsed = JSON.parse(text) as Partial<OpenWhiteboardNoteFile> | BoardProject
  if ('format' in parsed) {
    if (parsed.format !== NOTE_FORMAT_ID || parsed.version !== NOTE_FORMAT_VERSION || !parsed.project?.pages?.length) {
      throw new Error('unsupported note file')
    }
    return parsed.project
  }
  const project = parsed as BoardProject
  if (!project.pages?.length) throw new Error('invalid project file')
  return project
}

function noteFileName(date = new Date()) {
  return `clearboard-studio-${date.toISOString().slice(0, 10)}.${NOTE_EXTENSION}`
}

export { NOTE_EXTENSION, NOTE_MIME_TYPE, createNoteFile, noteFileName, parseNoteFileText, serializeNoteFile }
export type { OpenWhiteboardNoteFile }
