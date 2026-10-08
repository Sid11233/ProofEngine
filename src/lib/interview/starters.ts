// "Pre-answers": short sentence starters a client can tap to begin an answer. They are deliberately empty of facts:
// no numbers, results, names or claims, so nothing the client did not say can enter the story. Tapping one only puts the
// words in the box; the client finishes the sentence, and a bare starter cannot be sent.

const GENERIC = ["The main thing was…", "What I remember most is…", "For us, it meant…"];

const BY_KEY: Record<string, readonly string[]> = {
  challenge: ["We were struggling with…", "Our goal was to…", "The problem was that…"],
  trigger: ["We decided to get help when…", "What pushed us was…", "We realised we needed support because…"],
  solution: ["They helped us by…", "The first thing they did was…", "What stood out about their approach was…"],
  results: ["Since then, we have noticed…", "The biggest change has been…", "We now find it easier to…"],
  quote: ["I would tell a colleague that…", "Working with them felt…", "The best part was…"],
  audience: ["I think it would suit teams that…", "It is a great fit for anyone who…", "People who struggle with… would benefit most."],
};

export function startersFor(key: string | undefined): readonly string[] {
  return (key && BY_KEY[key]) || GENERIC;
}

/** True when the text is nothing but an unedited starter (or empty), so it should not be sent. */
export function isBareStarter(text: string): boolean {
  const t = text.trim();
  return t === "" || [...GENERIC, ...Object.values(BY_KEY).flat()].includes(t);
}
