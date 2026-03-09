import { CopilotClient } from "./copilot-client.js";

try {
	const client = new CopilotClient();
	console.log("Client initialized successfully!");
	await client.start();
	console.log("Client started!");
	const models = await client.listModels();
	console.log("Models:", models);
	await client.stop();
} catch (err) {
	console.error("Error:", err);
}
