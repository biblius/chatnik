const form = document.getElementById("chat-form");
const text = document.getElementById("chat-input")

form.addEventListener("submit", (e) => {
  e.preventDefault();

  _vscode.postMessage({
    command: 'sendMessage',
    message: text.value
  })
  text.value = ""
})