import { Page, PostMessageEvent } from "./shared.js";

const input = document.getElementById("guess-input") as HTMLInputElement;
const button = document.getElementById("submit-button") as HTMLButtonElement;

let page: Page = "splash";

function postMessage(event: PostMessageEvent) {
  window.parent?.postMessage(event, "*");
}

function handleSubmit() {
  if (!input.value) {
    return;
  }

  console.log("this one");
  postMessage({
    type: "WORD_SUBMITTED",
    value: input.value.trim().toLowerCase(),
  });
  input.value = "";
  input.focus();
}

// Handle button click
button.addEventListener("mousedown", (e) => {
  e.preventDefault();
  handleSubmit();
});

// Handle Enter key
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSubmit();
  }
});
