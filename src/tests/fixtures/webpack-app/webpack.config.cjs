const path = require('node:path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  mode: 'production',
  entry: './main.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  experiments: {
    asyncWebAssembly: true,
    topLevelAwait: true,
  },
  plugins: [new HtmlWebpackPlugin({ template: 'index.html' })],
  performance: { hints: false },
}
