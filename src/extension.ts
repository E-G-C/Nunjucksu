// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { NunjucksController } from './nunjucksController';

let controller: NunjucksController | undefined;

	export async function activate(context: vscode.ExtensionContext): Promise<void> {
	controller = new NunjucksController(context);
	context.subscriptions.push(controller);

	await controller.initialize();

	const renderAllDisposable = vscode.commands.registerCommand('nunjucksu.renderAll', async () => {
		await controller?.renderAll();
	});

	const diagnosticDisposable = vscode.commands.registerCommand('nunjucksu.showDiagnostics', async () => {
		if (!controller) {
			return;
		}
		const output = controller.getOutputChannel();
		output.show();
		output.appendLine('\n=== Nunjucksu Diagnostics ===');
		output.appendLine(`Config file transforms: ${controller.getConfigFileCount()}`);
		output.appendLine(`Directory transforms: ${controller.getDirectoryTransformCount()}`);
		output.appendLine(`Template transforms: ${controller.getTemplateTransformCount()}`);
		output.appendLine(`Total transforms: ${controller.getTotalTransformCount()}`);
		output.appendLine(`Source watchers: ${controller.getSourceWatcherCount()}`);
		output.appendLine('=============================\n');
	});

	context.subscriptions.push(renderAllDisposable, diagnosticDisposable);
}export function deactivate(): void {
	controller?.dispose();
	controller = undefined;
}
