import * as pdfjsDistImport from "pdfjs-dist";
import * as pdfjsViewerImport from "pdfjs-dist/web/pdf_viewer.mjs"
import "vscode-webview";

declare global {
    export import pdfjsLib = pdfjsDistImport;
    export import pdfjsViewer = pdfjsViewerImport;
}

export {}
