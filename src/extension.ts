// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { NunjucksController } from './nunjucksController';

let controller: NunjucksController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	controller = new NunjucksController(context);
	context.subscriptions.push(controller);

	await controller.initialize();

	const disposable = vscode.commands.registerCommand('nunjucksu.renderAll', async () => {
		await controller?.renderAll();
	});

	context.subscriptions.push(disposable);
}

export function deactivate(): void {
	controller?.dispose();
	controller = undefined;
}
