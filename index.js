const SourceMapSource = require("webpack-sources").SourceMapSource;
const OriginalSource = require("webpack-sources").OriginalSource;
const ModuleFilenameHelpers = require("webpack/lib/ModuleFilenameHelpers");
const RequestShortener = require("webpack/lib/RequestShortener");
const babel = require("babel-core");
const SourceMapGenerator = require("source-map").SourceMapGenerator;
const SourceMapConsumer = require("source-map").SourceMapConsumer;


class BabelPlugin {
	constructor(options) {
		if(typeof options !== "object" || Array.isArray(options)) options = {};
		this.options = options;
	}

	apply(compiler) {
		const options = this.options;
		options.test = options.test || /\.js($|\?)/i;
		options.presets = options.presets || ["es2015"];
		options.compact = options.compact || false;

		const requestShortener = new RequestShortener(compiler.context);
		compiler.plugin("compilation", (compilation) => {
			if(options.sourceMaps) {
				compilation.plugin("build-module", (module) => {
					// to get detailed location info about errors
					module.useSourceMap = true;
				});
			}
			compilation.plugin("optimize-chunk-assets", (chunks, callback) => {
				let files = [];
				chunks.forEach((chunk) => files.push(...chunk.files));
				files.push(...compilation.additionalChunkAssets);
				files = files.filter(ModuleFilenameHelpers.matchObject.bind(undefined, options));
				files.forEach((file) => {
					let sourceMap;
					try {
						const asset = compilation.assets[file];
						if(asset.__BabelPlugin) {
							compilation.assets[file] = asset.__BabelPlugin;
							return;
						}

						let input;
						let inputSourceMap;
						const fileOptions = Object.assign({}, options);
						delete fileOptions.test;

						if(options.sourceMaps) {
							if(asset.sourceAndMap) {
								const sourceAndMap = asset.sourceAndMap();
								inputSourceMap = sourceAndMap.map;
								input = sourceAndMap.source;
							} else {
								inputSourceMap = asset.map();
								input = asset.source();
							}
							if (inputSourceMap) {
								// shift line index by one
								const inputMapConsumer = new SourceMapConsumer(inputSourceMap);
								const generator = new SourceMapGenerator({
									file: inputMapConsumer.file,
									sourceRoot: inputMapConsumer.sourceRoot
								});
								inputMapConsumer.eachMapping((mapping) => {
									generator.addMapping({
										name: mapping.name,
										source: mapping.source,
										original: mapping.source == null ? null : {
											line: mapping.originalLine,
											column: mapping.originalColumn,
										},
										generated: {
											line: mapping.generatedLine + 1,
											column: mapping.generatedColumn,
										}
									});
								});
								inputSourceMap.mappings = generator.toJSON().mappings;
							}
							// fileOptions.inputSourceMap = inputSourceMap;
						} else {
							input = asset.source();
						}
						fileOptions.sourceRoot = "";
						fileOptions.sourceFileName = file;
						// wrapping top level 'this'
						// see https://github.com/babel/babel/issues/843
						input = `(function(){\n${input}\n}).call(typeof global !== "undefined" ? global : window);`;

						const result = babel.transform(input, fileOptions);

						let map;
						if(options.sourceMaps) {
							map = result.map;
						}

						const source = result.code;

						compilation.assets[file] = (map ?
							new SourceMapSource(source, file, map, input, inputSourceMap) :
							new OriginalSource(source, file));

						compilation.assets[file].__BabelPlugin = compilation.assets[file];

					} catch(err) {
						if(err.line) {
							const original = sourceMap && sourceMap.originalPositionFor({
								line: err.line,
								column: err.col
							});
							if(original && original.source) {
								compilation.errors.push(new Error(file + " from Babel\n" + err.message + " [" + requestShortener.shorten(original.source) + ":" + original.line + "," + original.column + "][" + file + ":" + err.line + "," + err.col + "]"));
							} else {
								compilation.errors.push(new Error(file + " from Babel\n" + err.message + " [" + file + ":" + err.line + "," + err.col + "]"));
							}
						} else if(err.msg) {
							compilation.errors.push(new Error(file + " from Babel\n" + err.msg));
						} else {
							compilation.errors.push(new Error(file + " from Babel\n" + err.stack));
						}
					}
				});
				callback();
			});
		});
	}
}

module.exports = BabelPlugin;
