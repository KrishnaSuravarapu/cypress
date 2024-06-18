import { sendFile } from '../upload/send_file'
import type { ArtifactUploadStrategy } from './artifact'
const logger = require('../../logger')

export const fileUploadStrategy: ArtifactUploadStrategy<Promise<any>> = (filePath, uploadUrl) => {
  logger.info(`Uploading ${filePath} to ${uploadUrl} in TypeScript`)

  return sendFile(filePath, uploadUrl)
}
