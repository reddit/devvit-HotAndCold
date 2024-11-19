// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import lemmatize from "npm:wink-lemmatizer";

const lemmatizeIt = (input: string) => {
  const word = input.trim().toLowerCase();
  // Early return if word is empty or not a string
  if (!word || typeof word !== "string") {
    return word;
  }

  // Try adjective first since it's most likely to be different if it is an adjective
  const adj = lemmatize.adjective(word);
  if (word !== adj) {
    return adj;
  }

  // Try verb next as it's typically the next most common case
  const verb = lemmatize.verb(word);
  if (word !== verb) {
    return verb;
  }

  // Try noun last as many words default to being nouns
  const noun = lemmatize.noun(word);
  if (word !== noun) {
    return noun;
  }

  // If no lemmatization changed the word, return original
  return word;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { wordA, wordB } = await req.json();

    if (!wordA || !wordB) {
      return new Response("Please provide two words", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const wordBLemma = lemmatizeIt(wordB);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: {
            Authorization: req.headers.get("Authorization")!,
          },
        },
      },
    );

    const { data, error } = await supabase
      .rpc("compare_word_similarity", {
        input_word1: wordA,
        input_word2: wordBLemma,
      });

    if (error) {
      console.error(error);
      throw error;
    }
    const response = data[0];
    return new Response(
      JSON.stringify({
        wordA: response.worda,
        wordB: wordB,
        wordBLemma: wordBLemma,
        similarity: response.similarity,
      }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 200,
      },
    );
  } catch (err) {
    return new Response(String(err?.message ?? err), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
