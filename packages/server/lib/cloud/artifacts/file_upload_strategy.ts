import { sendFile } from '../upload/send_file'
import type { ArtifactUploadStrategy } from './artifact'
const debug = require('debug')('cypress:server:turboscale')

export const fileUploadStrategy: ArtifactUploadStrategy<Promise<any>> = (filePath, uploadUrl) => {
  debug(`Uploading ${filePath} to ${uploadUrl} in TypeScript`)

  if (uploadUrl) {
    return sendFile(filePath, uploadUrl)
  }

  return ''
}
