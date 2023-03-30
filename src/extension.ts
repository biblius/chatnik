import { OpenAIApi } from "openai";
import * as vscode from "vscode";
import { openai } from "./chat";
import { AxiosResponse } from "axios";

export const EXTENSION_ID = "chatnik";

export async function activate(context: vscode.ExtensionContext) {
  console.log(`Booting "${EXTENSION_ID}"`);

  const config = loadConfig();

  const chat = new ChatManager();
  const openAiApi = openai(config.apiKey!);

  console.log("🚀 ~ file: extension.ts:10 ~ activate ~ config:", config);
  const provider = new SidebarProvider(
    context.extensionUri,
    config,
    chat,
    openAiApi
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`${EXTENSION_ID}.helloWorld`, () => {
      vscode.window.showInformationMessage("Hello World from Chatnik!");
    })
  );
}

export function deactivate() {}

type Message = {
  sender: string;
  content: string;
};

class ChatManager {
  private _messages: Message[] = [];

  public storeMessage(message: Message) {
    this._messages.push(message);
  }

  get messages() {
    return this._messages;
  }
}

class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = `${EXTENSION_ID}.openview`;

  private _view?: vscode.WebviewView;
  private config: Config;
  private chat: ChatManager;
  private openai: OpenAIApi;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    config: Config,
    chat: ChatManager,
    openai: OpenAIApi
  ) {
    this.config = config;
    this.chat = chat;
    this.openai = openai;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext<unknown>,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    this.setHtmlContent(webviewView);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.command) {
        case "submitKey": {
          if (!data.key) {
            vscode.window.showErrorMessage("API key cannot be empty.");
            return;
          }
          this.config.updateApiKey(data.key).then(() => {
            const key: string | undefined = vscode.workspace
              .getConfiguration(EXTENSION_ID)
              .get("apiKey");

            if (key) {
              vscode.window.showInformationMessage("Successfully set API Key");
              this.openai = openai(key);
              this.setHtmlContent(webviewView);
            } else {
              vscode.window.showWarningMessage("Api key not set");
            }
          });
          break;
        }
        case "sendMessage": {
          const message = data.message;

          if (!message) {
            return;
          }

          this.chat.storeMessage({ sender: "You", content: message });

          this.setHtmlContent(webviewView);

          this.openai
            .createChatCompletion({
              messages: [{ role: "user", content: message }],
              model: this.config.model!,
            })
            .then((response) => {
              console.log(
                "🚀 ~ file: extension.ts:112 ~ SidebarProvider ~ webviewView.webview.onDidReceiveMessage ~ response:",
                response
              );
            })
            .catch((error) => {
              const response: AxiosResponse = error.response;
              console.log(response);

              // Invalid API Key
              if (response.data.error.code === "invalid_api_key") {
                this.config.updateApiKey().then(() => {
                  vscode.window.showErrorMessage("Invalid API Key Provided");
                });
                return;
              }

              this.chat.storeMessage({
                sender: "Error",
                content: response.data.error.message,
              });
            })
            .finally(() => {
              this.setHtmlContent(webviewView);
            });
          break;
        }
        default: {
          console.warn("Cannot process command: " + data);
        }
      }
    });
  }

  private setHtmlContent(webview: vscode.WebviewView) {
    this.config.apiKey ? this.setChatHtml(webview) : this.setLoginHtml(webview);
  }

  private setChatHtml(webview: vscode.WebviewView) {
    const stylesheetUri = this._view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "chat.css")
    )!;

    const chatScriptUri = this._view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "chat.js")
    )!;

    const messages = this.chat.messages.map(
      (message) => `
      <div id="chat-message">
        <h1><strong>${message.sender}</strong></h1>
        <p class="message-content">${message.content}</p>
      </div>`
    );

    webview.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="${stylesheetUri}" />
      <script nonce="${getNonce()}"> 
        const _vscode = acquireVsCodeApi(); 
      </script>
    </head>
    <body>
      <h1>Chatnik</h1>
      <section id="chat">
        ${
          messages.length
            ? messages.join("")
            : '<p id="chat-placeholder">Send a message to your buddy to get started</p>'
        }
      </section>
      <form id="chat-form">
        <button type="submit">Send</button>
        <input type="text" placeholder="ayy buddy y dis dont work" id="chat-input">
      </form>
      <script src="${chatScriptUri}" />
    </body>
    </html>
    `;
  }

  private setLoginHtml(webview: vscode.WebviewView) {
    const stylesheetUri = this._view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "setApiKey.css")
    )!;

    const loginScriptUri = this._view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "setApiKey.js")
    )!;

    webview.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <link rel="stylesheet" href="${stylesheetUri}" />
      <script nonce="${getNonce()}"> 
        const _vscode = acquireVsCodeApi(); 
      </script>
    </head>
    <body>
      <h1>Login</h1>
        <input type="text" placeholder="Your API Key" id="key-input">
        <button id="submit-api-key">Submit Key</button>
      <script src="${loginScriptUri}" />
    </body>
    </html>
    `;
  }
}

class Config {
  private _apiKey?: string;
  private _model: string;

  constructor(apiKey?: string, model?: string) {
    this._apiKey = apiKey;
    this._model = model || "gpt-3.5-turbo";
  }

  get apiKey(): string | undefined {
    return this._apiKey;
  }

  set apiKey(key: string | undefined) {
    this._apiKey = key;
  }

  get model(): string {
    return this._model;
  }

  set model(model: string) {
    this._model = model;
  }

  public updateApiKey(key?: string): Thenable<void> {
    this._apiKey = key;
    return vscode.workspace
      .getConfiguration(EXTENSION_ID)
      .update("apiKey", key ? key : null, vscode.ConfigurationTarget.Workspace);
  }
}

function loadConfig(): Config {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);
  const apiKey: string | null | undefined = config.get("apiKey");
  return apiKey ? new Config(apiKey) : new Config();
}

export function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function updateDecorationsForUri(uriToDecorate: vscode.Uri) {
  if (!uriToDecorate) {
    return;
  }

  if (uriToDecorate.scheme !== "file") {
    return;
  }

  if (!vscode.window) {
    return;
  }

  const activeTextEditor: vscode.TextEditor | undefined =
    vscode.window.activeTextEditor;
  if (!activeTextEditor) {
    return;
  }

  if (!activeTextEditor.document.uri.fsPath) {
    return;
  }

  let numErrors = 0;
  let numWarnings = 0;

  let aggregatedDiagnostics: any = {};
  let diagnostic: vscode.Diagnostic;

  // Iterate over each diagnostic that VS Code has reported for this file. For each one, add to
  // a list of objects, grouping together diagnostics which occur on a single line.
  for (diagnostic of vscode.languages.getDiagnostics(uriToDecorate)) {
    let key = "line" + diagnostic.range.start.line;

    if (aggregatedDiagnostics[key]) {
      // Already added an object for this key, so augment the arrayDiagnostics[] array.
      aggregatedDiagnostics[key].arrayDiagnostics.push(diagnostic);
    } else {
      // Create a new object for this key, specifying the line: and a arrayDiagnostics[] array
      aggregatedDiagnostics[key] = {
        line: diagnostic.range.start.line,
        arrayDiagnostics: [diagnostic],
      };
    }

    switch (diagnostic.severity) {
      case 0:
        numErrors += 1;
        break;

      case 1:
        numWarnings += 1;
        break;

      // Ignore other severities.
    }
  }
}

// function to get the number of errors in the open file
function getNumErrors(): [number, number] {
  const activeTextEditor: vscode.TextEditor | undefined =
    vscode.window.activeTextEditor;
  if (!activeTextEditor) {
    return [0, 0];
  }
  const document: vscode.TextDocument = activeTextEditor.document;

  let numErrors = 0;
  let numWarnings = 0;

  let aggregatedDiagnostics: any = {};
  let diagnostic: vscode.Diagnostic;

  // Iterate over each diagnostic that VS Code has reported for this file. For each one, add to
  // a list of objects, grouping together diagnostics which occur on a single line.
  for (diagnostic of vscode.languages.getDiagnostics(document.uri)) {
    let key = "line" + diagnostic.range.start.line;

    if (aggregatedDiagnostics[key]) {
      // Already added an object for this key, so augment the arrayDiagnostics[] array.
      aggregatedDiagnostics[key].arrayDiagnostics.push(diagnostic);
    } else {
      // Create a new object for this key, specifying the line: and a arrayDiagnostics[] array
      aggregatedDiagnostics[key] = {
        line: diagnostic.range.start.line,
        arrayDiagnostics: [diagnostic],
      };
    }

    switch (diagnostic.severity) {
      case 0:
        numErrors += 1;
        break;

      case 1:
        numWarnings += 1;
        break;

      // Ignore other severities.
    }
  }

  return [numErrors, numWarnings];
}
