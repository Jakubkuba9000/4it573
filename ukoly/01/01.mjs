const secretNumber = Math.floor(Math.random() * 11);

let guess;
let attempts = 0;
const maxAttempts = 5;

while (attempts < maxAttempts) {
  const input = prompt(
    `Hádej číslo od 0 do 10 (pokus ${attempts + 1} z ${maxAttempts}):`
  );

  guess = Number(input);

  if (Number.isNaN(guess) || guess < 0 || guess > 10) {
    console.log("Zadej prosím celé číslo mezi 0 a 10.");
    continue;
  }

  attempts++;

  if (guess === secretNumber) {
    console.log(`Gratuluji! Uhodl(a) jsi číslo ${secretNumber} na ${attempts}. pokus.`);
    break;
  } else if (guess < secretNumber) {
    console.log("Tvůj tip je menší než hádané číslo.");
  } else {
    console.log("Tvůj tip je větší než hádané číslo.");
  }

  if (attempts === maxAttempts) {
    console.log(
      `Bohužel, neuhodl(a) jsi číslo ani po ${maxAttempts} pokusech. Správné číslo bylo ${secretNumber}.`
    );
  }
}