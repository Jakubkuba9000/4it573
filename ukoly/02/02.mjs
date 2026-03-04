import fs from "fs";

const instructionsFile = "instrukce.txt";

async function main() {
  try {
    await fs.promises.access(instructionsFile);
  } catch {
    console.error(`Soubor "${instructionsFile}" neexistuje.`);
    process.exit(1);
  }

  let instructionsContent;
  try {
    instructionsContent = await fs.promises.readFile(instructionsFile, "utf8");
  } catch (err) {
    console.error(`Nepodařilo se přečíst soubor "${instructionsFile}": ${err.message}`);
    process.exit(1);
  }

  const parts = instructionsContent.trim().split(/\s+/);

  if (parts.length < 2) {
    console.error(
      `Soubor "${instructionsFile}" musí obsahovat alespoň dva názvy souborů (zdrojový a cílový) oddělené mezerou.`
    );
    process.exit(1);
  }

  const [sourceFile, destinationFile] = parts;

  try {
    await fs.promises.access(sourceFile);
  } catch {
    console.error(`Zdrojový soubor "${sourceFile}" neexistuje.`);
    process.exit(1);
  }

  let data;
  try {
    data = await fs.promises.readFile(sourceFile);
  } catch (err) {
    console.error(`Nepodařilo se přečíst zdrojový soubor "${sourceFile}": ${err.message}`);
    process.exit(1);
  }

  try {
    await fs.promises.writeFile(destinationFile, data);
    console.log(`Data byla zkopírována z "${sourceFile}" do "${destinationFile}".`);
  } catch (err) {
    console.error(`Nepodařilo se zapsat do cílového souboru "${destinationFile}": ${err.message}`);
    process.exit(1);
  }
}

main();