const input = document.getElementById("key-input");
const button = document.getElementById("submit-api-key");

button.addEventListener('click', (_) => {
  _vscode.postMessage({
    command: 'submitKey',
    key: input.value
  })
})