import * as vscode from 'vscode';
import { PdfProvider } from './provider';

export function activate(context: vscode.ExtensionContext) {
	PdfProvider.register(context);
}

export function deactivate() {}
