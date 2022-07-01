import { URL } from "url";
import path from "path";

import { App, DataAdapter } from "obsidian";

import {
  isUrl,
  downloadImage,
  fileExtByContent,
  cleanFileName,
  pathJoin,
} from "./utils";
import {
  FILENAME_TEMPLATE,
  MAX_FILENAME_INDEX,
  FILENAME_ATTEMPTS,
} from "./config";
import { linkHashes } from "./linksHash";

export function imageTagProcessor(app: App, mediaDir: string) {
  async function processImageTag(match: string, anchor: string, link: string) {
    if (!isUrl(link)) {
      return match;
    }

    try {
      const fileData = await downloadImage(link);

      // when several images refer to the same file they can be partly
      // failed to download because file already exists, so try to resuggest filename several times
      let attempt = 0;
      while (attempt < FILENAME_ATTEMPTS) {
        try {
          const { fileName, imgName, needWrite } = await chooseFileName(
            app,
            mediaDir,
            anchor,
            link,
            fileData
          );

          if (needWrite && fileName) {
            await app.vault.createBinary(fileName, fileData);
          }

          if (fileName) {
            return `![${anchor}](${imgName})`;
          } else {
            return match;
          }
        } catch (error) {
          if (error.message === "File already exists.") {
            attempt++;
          } else {
            throw error;
          }
        }
      }
      return match;
    } catch (error) {
      console.warn("Image processing failed: ", error);
      return match;
    }
  }

  return processImageTag;
}

async function chooseFileName(
  app: App,
  dir: string,
  baseName: string,
  link: string,
  contentData: ArrayBuffer
): Promise<{ fileName: string; imgName: string; needWrite: boolean }> {
  const adapter = app.vault.adapter;
  const fileExt = await fileExtByContent(contentData);
  if (!fileExt) {
    return { fileName: "", imgName: "", needWrite: false };
  }
  // if there is no anchor try get file name from url
  if (!baseName) {
    const parsedUrl = new URL(link);

    baseName = path.basename(parsedUrl.pathname);
  }
  // if there is no part for file name from url use name template
  if (!baseName) {
    baseName = FILENAME_TEMPLATE;
  }

  // if filename already ends with correct extension, remove it to work with base name
  if (baseName.endsWith(`.${fileExt}`)) {
    baseName = baseName.slice(0, -1 * (fileExt.length + 1));
  }

  let activeFileName = app.workspace.getActiveFile().name;
  // truncate  name to avoid long file names
  if (activeFileName.length > 64) {
    activeFileName = activeFileName.slice(0, 64);
  }

  linkHashes.ensureHashGenerated(link, contentData);

  baseName = activeFileName + "_" + linkHashes.getHash(link) + "_" + baseName;

  baseName = cleanFileName(baseName);

  let fileName = "";
  let needWrite = true;
  let imgName = "";
  let index = 0;
  while (!fileName && index < MAX_FILENAME_INDEX) {
    imgName = index
      ? `${baseName}-${index}.${fileExt}`
      : `${baseName}.${fileExt}`;

    const suggestedName = pathJoin(dir, imgName);

    if (await adapter.exists(suggestedName, false)) {
      const fileData = await adapter.readBinary(suggestedName);

      if (linkHashes.isSame(link, fileData)) {
        fileName = suggestedName;
        needWrite = false;
      }
    } else {
      fileName = suggestedName;
    }

    index++;
  }
  if (!fileName) {
    throw new Error("Failed to generate file name for media file.");
  }

  return { fileName, imgName, needWrite };
}
