import fs from "fs/promises";

async function createFiles() {
  const content = await fs.readFile("instrukce.txt", "utf8");
  const n = Number(content.trim());

  if (Number.isNaN(n) || n < 0) {
    throw new Error("Soubor 'instrukce.txt' musí obsahovat nezáporné číslo.");
  }

  const promises = [];

  for (let i = 0; i <= n; i++) {
    const fileName = `${i}.txt`;
    const fileContent = `Soubor ${i}`;
    promises.push(fs.writeFile(fileName, fileContent, "utf8"));
  }

  await Promise.all(promises);

  console.log("Všechny soubory byly úspěšně vytvořeny (paralelní verze).");
}

createFiles().catch((err) => {
  console.error("Nastala chyba:", err.message);
});

