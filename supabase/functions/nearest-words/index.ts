// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { word } = await req.json();

    if (!word) {
      return new Response("Please provide a word", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      },
    );

    const cached = await supabase.from("cache").select("*").filter(
      "cache_key",
      "eq",
      word,
    ).single();

    if (cached.data) {
      console.debug(
        `Returning cached data for word "${word}"`,
      );

      return new Response(cached.data.data, {
        headers: {
          "Content-Type": "application/json",
          "x-hacky-cache-hit": "true",
          ...corsHeaders,
        },
        status: 200,
      });
    }

    const { data, error } = await supabase
      .rpc("get_similar_words", { target_word: word });

    if (error) {
      console.error(error);
      throw error;
    }

    if (data) {
      console.debug(`Caching data for word "${word}"`);
      const foo = await supabase.from("cache").insert([{
        cache_key: word,
        data: JSON.stringify(data[0]),
      }]).select();

      if (foo.error) {
        console.error(foo.error);
      }
    }

    return new Response(JSON.stringify(data[0]), {
      headers: {
        "Content-Type": "application/json",
        "x-hacky-cache-hit": "false",
        ...corsHeaders,
      },
      status: 200,
    });
  } catch (err) {
    return new Response(String(err?.message ?? err), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
