import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("src/utils/projectTree.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const {
  getBreadcrumbFolderNavigation,
  getVisibleWorkspaceFolderTreeRows,
} = await import(moduleUrl);

const rootPath = "C:\\fixture";
const chapterPath = `${rootPath}\\chapter`;
const chapterFilePath = `${chapterPath}\\overview.txt`;
const scenePath = `${chapterPath}\\scene`;
const nestedFilePath = `${scenePath}\\draft.txt`;
const siblingPath = `${rootPath}\\notes`;

const projectFolder = {
  path: rootPath,
  name: "fixture",
  children: [
    {
      path: chapterPath,
      name: "chapter",
      kind: "folder",
      children: [
        {
          path: chapterFilePath,
          name: "overview.txt",
          kind: "file",
          children: [],
        },
        {
          path: scenePath,
          name: "scene",
          kind: "folder",
          children: [
            {
              path: nestedFilePath,
              name: "draft.txt",
              kind: "file",
              children: [],
            },
          ],
        },
      ],
    },
    {
      path: siblingPath,
      name: "notes",
      kind: "folder",
      children: [],
    },
  ],
};

assert.deepEqual(
  getBreadcrumbFolderNavigation(projectFolder, chapterPath, scenePath),
  {
    path: scenePath,
    name: "scene",
    children: projectFolder.children[0].children[1].children,
    parentPath: chapterPath,
    parentName: "chapter",
  },
  "a breadcrumb popover must be able to browse into a descendant folder",
);

assert.deepEqual(
  getBreadcrumbFolderNavigation(projectFolder, rootPath, scenePath),
  {
    path: scenePath,
    name: "scene",
    children: projectFolder.children[0].children[1].children,
    parentPath: chapterPath,
    parentName: "chapter",
  },
  "root-anchored navigation must preserve the immediate back target",
);

const outOfBranch = getBreadcrumbFolderNavigation(
  projectFolder,
  chapterPath,
  siblingPath,
);
assert.equal(outOfBranch?.path, chapterPath);
assert.equal(outOfBranch?.parentPath, null);
assert.deepEqual(
  outOfBranch?.children.map((entry) => entry.path),
  [chapterFilePath, scenePath],
  "an out-of-branch browse path must fall back to the visible anchor",
);

const fileBrowse = getBreadcrumbFolderNavigation(
  projectFolder,
  chapterPath,
  nestedFilePath,
);
assert.equal(fileBrowse?.path, chapterPath, "files cannot become folder browse targets");

assert.equal(
  getBreadcrumbFolderNavigation(projectFolder, nestedFilePath, nestedFilePath),
  null,
  "a file cannot anchor a breadcrumb folder menu",
);

const collapsedTree = new Set([chapterPath, scenePath, siblingPath]);
assert.deepEqual(
  getVisibleWorkspaceFolderTreeRows(projectFolder, collapsedTree).map(
    ({ entry, depth }) => [entry.path, depth],
  ),
  [
    [rootPath, 0],
    [chapterPath, 1],
    [siblingPath, 1],
  ],
  "collapsed folders must initially show a concise list of project folders",
);

collapsedTree.delete(chapterPath);
assert.deepEqual(
  getVisibleWorkspaceFolderTreeRows(projectFolder, collapsedTree).map(
    ({ entry, depth }) => [entry.path, depth],
  ),
  [
    [rootPath, 0],
    [chapterPath, 1],
    [chapterFilePath, 2],
    [scenePath, 2],
    [siblingPath, 1],
  ],
  "expanding a workspace-switcher folder must expose its files and descendants",
);

collapsedTree.delete(scenePath);
assert.equal(
  getVisibleWorkspaceFolderTreeRows(projectFolder, collapsedTree).some(
    ({ entry }) => entry.path === nestedFilePath,
  ),
  true,
  "expanding a nested folder must expose its files",
);

const layoutSource = await readFile("src/utils/breadcrumbLayout.ts", "utf8");
const layoutCode = ts.transpileModule(layoutSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const layoutModuleUrl = `data:text/javascript;base64,${Buffer.from(layoutCode).toString("base64")}`;
const {
  getBreadcrumbLayout,
  isBreadcrumbTrailItemVisible,
  isOutlineBreadcrumbItemVisible,
} = await import(layoutModuleUrl);

assert.equal(getBreadcrumbLayout(239), "minimal");
assert.equal(getBreadcrumbLayout(240), "compact");
assert.equal(getBreadcrumbLayout(479), "compact");
assert.equal(getBreadcrumbLayout(480), "full");

assert.deepEqual(
  [0, 1, 2, 3].filter((index) =>
    isBreadcrumbTrailItemVisible("compact", index, 4, false),
  ),
  [0, 3],
  "compact breadcrumbs keep the workspace and current file",
);
assert.deepEqual(
  [0, 1, 2, 3].filter((index) =>
    isBreadcrumbTrailItemVisible("compact", index, 4, true),
  ),
  [0],
  "an active outline becomes the compact current location",
);
assert.deepEqual(
  [0, 1, 2, 3].filter((index) =>
    isBreadcrumbTrailItemVisible("minimal", index, 4, false),
  ),
  [3],
  "minimal breadcrumbs keep only the current file",
);
assert.deepEqual(
  [0, 1, 2, 3].filter((index) =>
    isBreadcrumbTrailItemVisible("minimal", index, 4, true),
  ),
  [],
  "minimal breadcrumbs move all file ancestors into the overflow menu",
);
assert.deepEqual(
  [0, 1, 2].filter((index) =>
    isOutlineBreadcrumbItemVisible("compact", index, 3),
  ),
  [2],
  "compact outline breadcrumbs keep only the active heading",
);

console.log("breadcrumb navigation tests passed");
