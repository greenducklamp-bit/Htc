const fs = require('fs');

const indexContent = [
  'import React from "react";',
  'import ReactDOM from "react-dom/client";',
  'import App from "./App";',
  '',
  'const root = ReactDOM.createRoot(document.getElementById("root"));',
  'root.render(<React.StrictMode><App /></React.StrictMode>);',
].join('\n');

fs.writeFileSync('./src/index.js', indexContent, 'utf8');
console.log('index.js written successfully');
