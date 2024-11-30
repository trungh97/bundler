const fs = require("fs");
const path = require("path");
const babylon = require("babylon");
const traverse = require("@babel/traverse").default;
const babel = require("@babel/core");

let ID = 0;

/**
 * Reads a file given the path without extension. It guesses the extension by
 * looking for the first file in the directory that starts with the given name.
 *
 * @param {string} pathWithNoExtension - The path without the extension.
 * @returns {?string} The content of the file, or null if not found.
 */
function readFileGuessExtension(pathWithNoExtension) {
  try {
    let files = fs.readdirSync(path.dirname(pathWithNoExtension));
    let name = path.parse(pathWithNoExtension).base;
    let found = files.find((x) => x.indexOf(name) === 0);
    return fs.readFileSync(
      path.dirname(pathWithNoExtension) + "/" + found,
      "utf-8"
    );
  } catch (e) {
    return null;
  }
}

/**
 * Creates an asset given a filename.
 *
 * @param {string} filename - The path to the file without extension.
 * @returns {Object} An object with the following properties:
 *   - {number} id - The unique identifier of the asset.
 *   - {string} filename - The filename of the asset.
 *   - {Array<string>} dependencies - The dependencies of the asset.
 *   - {string} code - The transformed code of the asset.
 */
function createAsset(filename) {
  const content = readFileGuessExtension(filename);

  const ast = babylon.parse(content, {
    sourceType: "module",
  });

  const dependencies = [];

  traverse(ast, {
    ImportDeclaration({ node }) {
      dependencies.push(`${node.source.value}`);
    },
  });

  const id = ID++;

  const { code } = babel.transformFromAstSync(ast, null, {
    presets: ["@babel/preset-env"],
  });

  return {
    id,
    filename,
    dependencies,
    code,
  };
}

/**
 * Creates a graph of assets given an entry point.
 *
 * @param {string} entry - The path to the entry point of the application.
 * @returns {Array<Object>} An array of objects with the following properties:
 *   - {number} id - The unique identifier of the asset.
 *   - {string} filename - The filename of the asset.
 *   - {Array<string>} dependencies - The dependencies of the asset.
 *   - {Object} mapping - The mapping of the dependencies to their corresponding asset id.
 *   - {string} code - The transformed code of the asset.
 */
function createGraph(entry) {
  const mainAsset = createAsset(entry);

  const queue = [mainAsset];

  for (const asset of queue) {
    const dirname = path.dirname(asset.filename);

    asset.mapping = {};

    asset.dependencies.forEach((relativePath) => {
      const absolutePath = path.join(dirname, relativePath);

      const child = createAsset(`${absolutePath}`);

      asset.mapping[relativePath] = child.id;

      queue.push(child);
    });
  }

  return queue;
}

function bundle(graph) {
  let modules = "";

  graph.forEach((module) => {
    modules += `${module.id}: [
        function(require, module, exports) {
          ${module.code}
        },
        ${JSON.stringify(module.mapping)}
    ],`;
  });

  const result = `
    (function(modules) {
      function require(id) {
        const [fn, mapping] = modules[id];

        function localRequire(relativePath) {
          return require(mapping[relativePath]);
        }

        const module = { exports: {} };

        fn(localRequire, module, module.exports);

        return module.exports;
      }

      require(0);
    })({${modules}})
  `;

  return result;
}

const graph = createGraph("./entry.js");

const result = bundle(graph);

console.log(result);
