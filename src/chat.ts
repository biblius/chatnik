import { Configuration, OpenAIApi } from "openai";

export function openai(key: string): OpenAIApi {
  const configuration = new Configuration({
    apiKey: key,
  });

  return new OpenAIApi(configuration);
}
