import { WebR, ChannelType } from "https://webr.r-wasm.org/v0.6.0/webr.mjs";

const PATHS = {
  trackingDirectory: "Participant Tracking",
  trackingFile: "R01 T&T Master Tracking.xlsx",
  checksDirectory: "Mid Assessment Data Checks",
  heightWeightDirectory: "Height and Weight",
  requiredImageSubfolders: [
    "1_height_pic",
    "2_height_pic",
    "3_height_pic",
    "1_weight_pic",
    "2_weight_pic",
    "3_weight_pic",
  ],
};

const IMAGE_PATTERN = /\.(jpe?g|png|heic|mov)$/i;
const SAV_PATTERN = /^Height\+and\+Weight.*\.sav$/i;

const elements = {
  cohort: document.querySelector("#cohort"),
  assessment: document.querySelector("#assessment"),
  selectFolder: document.querySelector("#selectFolder"),
  folderName: document.querySelector("#folderName"),
  runButton: document.querySelector("#runButton"),
  clearLog: document.querySelector("#clearLog"),
  log: document.querySelector("#log"),
  statusBadge: document.querySelector("#statusBadge"),
};

for (const letter of "ABCDEFGHIJ") {
  const option = document.createElement("option");
  option.value = letter;
  option.textContent = letter;
  elements.cohort.append(option);
}

elements.cohort.value = "A";

let baseDirectoryHandle = null;
let webRReady = false;
let running = false;

const webR = new WebR({
  channelType: ChannelType.PostMessage,
});

function setStatus(text, className) {
  elements.statusBadge.textContent = text;
  elements.statusBadge.className = `status-badge ${className}`;
}

function appendLog(message = "") {
  const timestamp = new Date().toLocaleTimeString();
  const existing = elements.log.textContent.trim();
  const nextLine = `[${timestamp}] ${message}`;
  elements.log.textContent = existing ? `${existing}\n${nextLine}` : nextLine;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function updateRunButton() {
  elements.runButton.disabled = !webRReady || !baseDirectoryHandle || running;
  elements.selectFolder.disabled = running;
  elements.cohort.disabled = running;
  elements.assessment.disabled = running;
}

function friendlyError(error) {
  if (error?.name === "AbortError") return "Folder selection was cancelled.";
  if (error?.name === "NotAllowedError") {
    return "Chrome did not grant read/write permission for the selected folder.";
  }

  const message = error?.message || String(error);
  return message
    .replace(/^Error:\s*/i, "")
    .replace(/^evaluation error:\s*/i, "")
    .trim();
}

async function initialiseWebR() {
  try {
    setStatus("Loading R…", "status-loading");
    appendLog("Starting R in the browser.");
    await webR.init();

    appendLog("Loading the R packages needed to read Excel and SPSS files.");
    await webR.installPackages(["readxl", "haven"]);

    const response = await fetch("analysis.R", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load analysis.R (${response.status}).`);
    }
    const analysisCode = await response.text();
    await webR.evalRVoid(analysisCode);

    webRReady = true;
    setStatus("Ready", "status-ready");
    appendLog("R is ready. Select the project folder.");
  } catch (error) {
    setStatus("R failed to load", "status-error");
    appendLog(`ERROR: ${friendlyError(error)}`);
  } finally {
    updateRunButton();
  }
}

async function selectBaseDirectory() {
  if (!("showDirectoryPicker" in window)) {
    throw new Error(
      "This browser does not support selecting a local folder. Open the app directly in a current version of Chrome or Edge over HTTPS."
    );
  }

  const handle = await window.showDirectoryPicker({
    id: "tots-tech-height-weight-base",
    mode: "readwrite",
    startIn: "documents",
  });

  const permission = await verifyPermission(handle, true);
  if (!permission) {
    throw new Error("Read/write permission was not granted for the selected folder.");
  }

  baseDirectoryHandle = handle;
  elements.folderName.textContent = handle.name;
  appendLog(`Selected project folder: ${handle.name}`);
  updateRunButton();
}

async function verifyPermission(handle, readWrite = false) {
  const options = readWrite ? { mode: "readwrite" } : {};
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

async function getRequiredDirectory(parent, name, description = name) {
  try {
    return await parent.getDirectoryHandle(name, { create: false });
  } catch (error) {
    if (error.name === "NotFoundError") {
      throw new Error(`Could not find the required ${description} folder: '${name}'.`);
    }
    if (error.name === "TypeMismatchError") {
      throw new Error(`'${name}' exists, but it is not a folder.`);
    }
    throw error;
  }
}

async function getRequiredFile(parent, name, description = name) {
  try {
    return await parent.getFileHandle(name, { create: false });
  } catch (error) {
    if (error.name === "NotFoundError") {
      throw new Error(`Could not find the required ${description}: '${name}'.`);
    }
    if (error.name === "TypeMismatchError") {
      throw new Error(`'${name}' exists, but it is not a file.`);
    }
    throw error;
  }
}

async function listEntries(directory) {
  const entries = [];
  for await (const [name, handle] of directory.entries()) {
    entries.push({ name, handle });
  }
  return entries;
}

async function directoryHasContents(directory) {
  for await (const _entry of directory.values()) {
    return true;
  }
  return false;
}

async function collectImageFiles(directory, relativeParts = []) {
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory") {
      files.push(...(await collectImageFiles(handle, [...relativeParts, name])));
    } else if (IMAGE_PATTERN.test(name)) {
      files.push({
        name,
        handle,
        relativePath: [...relativeParts, name].join("/"),
      });
    }
  }
  return files;
}

function fileStem(filename) {
  const lastDot = filename.lastIndexOf(".");
  const withoutExtension = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  return withoutExtension.trim().toLowerCase();
}

function fileExtension(filename) {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : "";
}

function addDupeSuffix(filename, index) {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return `${filename}_dupe_${index}`;
  return `${filename.slice(0, lastDot)}_dupe_${index}${filename.slice(lastDot)}`;
}

function uniqueTargetName(candidate, usedNames) {
  let target = candidate;
  let counter = 1;
  while (usedNames.has(target.toLowerCase())) {
    target = addDupeSuffix(candidate, counter);
    counter += 1;
  }
  usedNames.add(target.toLowerCase());
  return target;
}

async function copyFile(sourceHandle, destinationDirectory, destinationName) {
  const sourceFile = await sourceHandle.getFile();
  const destinationHandle = await destinationDirectory.getFileHandle(destinationName, { create: true });
  const writable = await destinationHandle.createWritable({ keepExistingData: false });
  try {
    await writable.write(sourceFile);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // The stream may already be closed; rollback still removes the destination entry.
    }
    throw error;
  }
}

async function removeVirtualFile(path) {
  try {
    await webR.FS.unlink(path);
  } catch {
    // The file does not yet exist in the webR virtual filesystem.
  }
}

async function writeFileToWebR(path, file) {
  await removeVirtualFile(path);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await webR.FS.writeFile(path, bytes);
}

async function prepareRun() {
  const cohort = elements.cohort.value;
  const assessment = elements.assessment.value;
  const outputName = `check_ht_wt (${cohort}_${assessment})`;

  appendLog("Beginning validation. No output has been created.");

  if (!(await verifyPermission(baseDirectoryHandle, true))) {
    throw new Error("Read/write permission for the selected project folder is no longer available.");
  }

  const trackingDirectory = await getRequiredDirectory(
    baseDirectoryHandle,
    PATHS.trackingDirectory,
    "Participant Tracking"
  );
  const trackingFileHandle = await getRequiredFile(
    trackingDirectory,
    PATHS.trackingFile,
    "Master Tracking workbook"
  );
  const checksDirectory = await getRequiredDirectory(
    trackingDirectory,
    PATHS.checksDirectory,
    "Mid Assessment Data Checks"
  );
  const heightWeightDirectory = await getRequiredDirectory(
    checksDirectory,
    PATHS.heightWeightDirectory,
    "Height and Weight"
  );

  const heightWeightEntries = await listEntries(heightWeightDirectory);

  const outputEntry = heightWeightEntries.find(
    (entry) => entry.name.toLowerCase() === outputName.toLowerCase()
  );

  let existingOutputHandle = null;
  if (outputEntry) {
    if (outputEntry.handle.kind !== "directory") {
      throw new Error(`'${outputName}' already exists but is not a folder. No files were copied.`);
    }
    if (await directoryHasContents(outputEntry.handle)) {
      throw new Error(
        `Output folder '${outputName}' already exists and contains at least one file or subfolder. ` +
          "Delete or move that output folder's contents before running this cohort and assessment again."
      );
    }
    existingOutputHandle = outputEntry.handle;
    appendLog(`Output folder '${outputName}' exists but is empty; it may be used.`);
  }

  const savEntries = heightWeightEntries.filter(
    (entry) => entry.handle.kind === "file" && SAV_PATTERN.test(entry.name)
  );
  if (savEntries.length === 0) {
    throw new Error(
      "No .sav file beginning with 'Height+and+Weight' was found in the Height and Weight folder."
    );
  }
  if (savEntries.length > 1) {
    throw new Error(
      `Multiple Height+and+Weight .sav files were found (${savEntries.map((x) => x.name).join(", ")}). ` +
        "Keep only the file that should be processed."
    );
  }

  const imageFolderEntries = heightWeightEntries.filter(
    (entry) => entry.handle.kind === "directory" && /images/i.test(entry.name)
  );
  if (imageFolderEntries.length === 0) {
    throw new Error("No folder containing 'Images' was found in the Height and Weight folder.");
  }
  if (imageFolderEntries.length > 1) {
    throw new Error(
      `Multiple folders containing 'Images' were found (${imageFolderEntries.map((x) => x.name).join(", ")}). ` +
        "Keep exactly one images folder."
    );
  }

  const imagesDirectory = imageFolderEntries[0].handle;
  const sourceImages = [];
  for (const folderName of PATHS.requiredImageSubfolders) {
    const folder = await getRequiredDirectory(imagesDirectory, folderName, "image subfolder");
    const found = await collectImageFiles(folder, [folderName]);
    sourceImages.push(...found);
  }

  if (sourceImages.length === 0) {
    throw new Error("No JPG, JPEG, PNG, HEIC, or MOV files were found in the six expected image subfolders.");
  }

  appendLog(`Found ${sourceImages.length} source image/video file(s).`);
  appendLog("Reading the tracking workbook and SPSS survey file in R.");

  const trackingFile = await trackingFileHandle.getFile();
  const savFile = await savEntries[0].handle.getFile();
  if (trackingFile.size === 0) throw new Error("The Master Tracking workbook is empty.");
  if (savFile.size === 0) throw new Error("The Height+and+Weight .sav file is empty.");

  await writeFileToWebR("/tmp/master_tracking.xlsx", trackingFile);
  await writeFileToWebR("/tmp/height_weight.sav", savFile);

  const safeCohort = cohort.replace(/[^A-Z]/g, "");
  const result = await webR.evalR(
    `build_manifest("/tmp/master_tracking.xlsx", "/tmp/height_weight.sav", "${safeCohort}")`
  );

  let manifest;
  try {
    manifest = await result.toD3();
  } finally {
    await webR.destroy(result);
  }

  const mappingsByStem = new Map();

  for (const row of manifest) {
    const stem = String(row.source_stem).toLowerCase();
    const existing = mappingsByStem.get(stem) || [];
    existing.push(row);
    mappingsByStem.set(stem, existing);
  }

  const sourceStemSet = new Set(sourceImages.map((item) => fileStem(item.name)));
  const missingExpected = manifest.filter((row) => !sourceStemSet.has(String(row.source_stem).toLowerCase()));

  if (missingExpected.length > 0) {
    appendLog(
      `NOTE: ${missingExpected.length} expected image filename(s) were not found. ` +
        "These are commonly incomplete survey submissions and do not block the run."
    );
  }

  const usedTargetNames = new Set();
  const copyPlan = sourceImages.map((source) => {
    const matches = mappingsByStem.get(fileStem(source.name));
    const match = matches ? matches[0] : null;
    const extension = fileExtension(source.name);
    const candidate = match
      ? `${String(match.target_base).replaceAll(":", "-")}.${extension}`
      : source.name;

    return {
      ...source,
      matched: Boolean(match),
      targetName: uniqueTargetName(candidate, usedTargetNames),
    };
  });

  // Preflight every source handle before creating the output folder.
  let totalBytes = 0;
  for (const item of copyPlan) {
    const file = await item.handle.getFile();
    totalBytes += file.size;
  }

  const matchedCount = copyPlan.filter((x) => x.matched).length;
  const unmatchedCount = copyPlan.length - matchedCount;
  appendLog(
    `Validation complete: ${matchedCount} matched and ${unmatchedCount} unmatched file(s); ` +
      `${(totalBytes / (1024 * 1024)).toFixed(1)} MB total.`
  );
  appendLog("All checks passed. Creating the output and copying files now.");

  return {
    outputName,
    heightWeightDirectory,
    existingOutputHandle,
    copyPlan,
    matchedCount,
    unmatchedCount,
    missingExpectedCount: missingExpected.length,
  };
}

async function executeCopy(prepared) {
  let outputDirectory = prepared.existingOutputHandle;
  let createdOutputDirectory = false;
  const createdFiles = [];

  try {
    if (!outputDirectory) {
      outputDirectory = await prepared.heightWeightDirectory.getDirectoryHandle(prepared.outputName, {
        create: true,
      });
      createdOutputDirectory = true;
    }

    // Re-check immediately before writing in case another run added content.
    if (await directoryHasContents(outputDirectory)) {
      throw new Error(
        `Output folder '${prepared.outputName}' is no longer empty. No new files will be copied.`
      );
    }

    for (let i = 0; i < prepared.copyPlan.length; i += 1) {
      const item = prepared.copyPlan[i];
      createdFiles.push(item.targetName);
      await copyFile(item.handle, outputDirectory, item.targetName);

      if ((i + 1) % 25 === 0 || i + 1 === prepared.copyPlan.length) {
        appendLog(`Copied ${i + 1} of ${prepared.copyPlan.length} file(s).`);
      }
    }

    return prepared.copyPlan.length;
  } catch (error) {
    appendLog("A copy error occurred. Rolling back files created during this run.");

    if (outputDirectory) {
      for (const name of [...createdFiles].reverse()) {
        try {
          await outputDirectory.removeEntry(name);
        } catch {
          // Continue attempting rollback of the remaining files.
        }
      }
    }

    if (createdOutputDirectory) {
      try {
        await prepared.heightWeightDirectory.removeEntry(prepared.outputName, { recursive: true });
      } catch {
        // The folder may already have been removed or may require manual cleanup.
      }
    }

    throw new Error(
      `${friendlyError(error)} Any files created successfully before the error were removed where possible.`
    );
  }
}

async function runApp() {
  if (running) return;
  running = true;
  updateRunButton();
  setStatus("Validating…", "status-running");

  try {
    const prepared = await prepareRun();
    setStatus("Copying…", "status-running");
    const copiedCount = await executeCopy(prepared);

    setStatus("Complete", "status-success");
    appendLog(
      `SUCCESS: ${copiedCount} file(s) were copied into '${prepared.outputName}'. ` +
        `${prepared.unmatchedCount} unmatched file(s) were retained with their original names.`
    );
  } catch (error) {
    setStatus("Stopped", "status-error");
    appendLog(`STOPPED: ${friendlyError(error)}`);
  } finally {
    running = false;
    updateRunButton();
  }
}

elements.selectFolder.addEventListener("click", async () => {
  try {
    await selectBaseDirectory();
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus("Folder not selected", "status-error");
      appendLog(`ERROR: ${friendlyError(error)}`);
    }
  }
});

elements.runButton.addEventListener("click", runApp);

elements.clearLog.addEventListener("click", () => {
  elements.log.textContent = "";
});

initialiseWebR();
