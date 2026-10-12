import { startE2EServer } from "../../scripts/start-e2e.mjs";

export default async function globalSetup(){
 return await startE2EServer();
}
