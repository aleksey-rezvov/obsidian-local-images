import { URL } from "url";
import path from "path";
import AsyncLock from "async-lock";

import { App, DataAdapter } from "obsidian";

import {
  isUrl,
  downloadImage,
  fileExtByContent,
  cleanFileName,
  pathJoin,
  genRandomStr,
} from "./utils";
import {
  FILENAME_TEMPLATE,
  MAX_FILENAME_SUFFIX_LEN,
} from "./config";
import { linkHashes } from "./linksHash";

var lock = new AsyncLock();

export function imageTagProcessor(app: App, mediaDir: string) {
  async function processImageTag(match: string, anchor: string, link: string) {
    if (!isUrl(link)) {
      return match;
    }

    const fileData = await downloadImage(link);

    const fileExt = await fileExtByContent(fileData);
    if (!fileExt) {
      return match;
    }

    const baseName = getBaseName(anchor, link, fileExt);

    return await lock.acquire(baseName, async function() {
      const { fileName, needWrite } = await chooseFileName(
        app.vault.adapter,
        mediaDir,
        baseName,
        link,
        fileData,
        fileExt
      );

      if (needWrite && fileName) {
        await app.vault.createBinary(fileName, fileData);
      }

      if (fileName) {
        return `![${anchor}](${fileName})`;
      }

      return match;
    }).catch(function(error: any) {
      console.warn("Image processing failed: ", error);
      return match;
    })
  }

  return processImageTag;
}

function getBaseName(anchor: string, link: string, fileExt: string) : string {
  let baseName = anchor;
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

  return cleanFileName(baseName);
}

async function chooseFileName(
  adapter: DataAdapter,
  dir: string,
  baseName: string,
  link: string,
  contentData: ArrayBuffer,
  fileExt: string
): Promise<{ fileName: string; needWrite: boolean }> {
  let fileName = "";
  let needWrite = true;
  let suffix = "";
  while (!fileName) {
    const suggestedName = suffix
      ? pathJoin(dir, `${baseName}-${suffix}.${fileExt}`)
      : pathJoin(dir, `${baseName}.${fileExt}`);

    if (await adapter.exists(suggestedName, false)) {
      linkHashes.ensureHashGenerated(link, contentData);

      const fileData = await adapter.readBinary(suggestedName);

      if (linkHashes.isSame(link, fileData)) {
        fileName = suggestedName;
        needWrite = false;
      }
    } else {
      fileName = suggestedName;
    }

    suffix = genRandomStr(MAX_FILENAME_SUFFIX_LEN);
  }
  if (!fileName) {
    throw new Error("Failed to generate file name for media file.");
  }

  linkHashes.ensureHashGenerated(link, contentData);

  return { fileName, needWrite };
}
