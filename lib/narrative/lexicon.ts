export type ConceptGroup = "person" | "asset" | "technology" | "company" | "meme" | "animal" | "culture" | "market"

export type Concept = {
  id: string
  label: string
  group: ConceptGroup
  /** Lowercase phrases matched as whole words in the token name. */
  aliases: string[]
  /** Uppercase fragments matched against the ticker. Fragments shorter than 4 characters only match as a whole ticker or as a prefix/suffix beside another known fragment. */
  ticker: string[]
  /** Generic words produce weaker news-origin claims. */
  generic?: boolean
}

export const CONCEPTS: Concept[] = [
  { id: "elon-musk", label: "Elon Musk", group: "person", aliases: ["elon musk", "elon", "musk"], ticker: ["ELON", "MUSK"] },
  { id: "vitalik", label: "Vitalik Buterin", group: "person", aliases: ["vitalik buterin", "vitalik", "buterin"], ticker: ["VITALIK", "BUTERIN"] },
  { id: "donald-trump", label: "Donald Trump", group: "person", aliases: ["donald trump", "trump"], ticker: ["TRUMP"] },
  { id: "cz", label: "Changpeng Zhao", group: "person", aliases: ["changpeng zhao", "cz binance"], ticker: ["CZ"] },
  { id: "sbf", label: "Sam Bankman-Fried", group: "person", aliases: ["sam bankman fried", "bankman", "sbf"], ticker: ["SBF"] },
  { id: "kanye", label: "Kanye West", group: "person", aliases: ["kanye west", "kanye", "ye west"], ticker: ["KANYE"] },
  { id: "ansem", label: "Ansem", group: "person", aliases: ["ansem"], ticker: ["ANSEM"] },
  { id: "ethereum", label: "Ethereum", group: "asset", aliases: ["ethereum", "ether"], ticker: ["ETH"], generic: true },
  { id: "bitcoin", label: "Bitcoin", group: "asset", aliases: ["bitcoin", "btc"], ticker: ["BTC"], generic: true },
  { id: "solana", label: "Solana", group: "asset", aliases: ["solana"], ticker: ["SOL"] },
  { id: "ai", label: "AI", group: "technology", aliases: ["artificial intelligence", "ai"], ticker: ["AI"], generic: true },
  { id: "agi", label: "AGI", group: "technology", aliases: ["artificial general intelligence", "agi"], ticker: ["AGI"] },
  { id: "superintelligence", label: "Superintelligence", group: "technology", aliases: ["superintelligence", "super intelligence", "superintelligent", "super intelligent", "super intel"], ticker: ["SI"] },
  { id: "robot", label: "Robots", group: "technology", aliases: ["robotics", "robot", "robots", "optimus"], ticker: ["ROBOT", "OPTIMUS"] },
  { id: "spacex", label: "SpaceX", group: "company", aliases: ["spacex", "space x", "starship"], ticker: ["SPACEX", "STARSHIP"] },
  { id: "tesla", label: "Tesla", group: "company", aliases: ["tesla"], ticker: ["TESLA"] },
  { id: "xai", label: "xAI", group: "company", aliases: ["xai", "x ai"], ticker: ["XAI"] },
  { id: "openai", label: "OpenAI", group: "company", aliases: ["openai", "open ai", "chatgpt", "gpt"], ticker: ["OPENAI", "GPT"] },
  { id: "nvidia", label: "Nvidia", group: "company", aliases: ["nvidia"], ticker: ["NVIDIA", "NVDA"] },
  { id: "pepe", label: "Pepe", group: "meme", aliases: ["pepe"], ticker: ["PEPE"] },
  { id: "doge", label: "Doge", group: "meme", aliases: ["doge", "dogecoin"], ticker: ["DOGE"] },
  { id: "shiba", label: "Shiba Inu", group: "meme", aliases: ["shiba inu", "shiba", "shib"], ticker: ["SHIB", "SHIBA"] },
  { id: "wojak", label: "Wojak", group: "meme", aliases: ["wojak"], ticker: ["WOJAK"] },
  { id: "bogdanoff", label: "Bogdanoff", group: "meme", aliases: ["bogdanoff"], ticker: ["BOGD"] },
  { id: "chad", label: "Chad", group: "meme", aliases: ["chad"], ticker: ["CHAD"] },
  { id: "bonk", label: "Bonk", group: "meme", aliases: ["bonk"], ticker: ["BONK"] },
  { id: "floki", label: "Floki", group: "meme", aliases: ["floki"], ticker: ["FLOKI"] },
  { id: "mog", label: "Mog", group: "meme", aliases: ["mog"], ticker: ["MOG"] },
  { id: "dog", label: "Dog", group: "animal", aliases: ["dog", "doggy", "puppy"], ticker: ["DOG", "PUPPY"], generic: true },
  { id: "cat", label: "Cat", group: "animal", aliases: ["cat", "kitty", "kitten"], ticker: ["CAT", "KITTY"], generic: true },
  { id: "frog", label: "Frog", group: "animal", aliases: ["frog"], ticker: ["FROG"], generic: true },
  { id: "meme", label: "Meme coin", group: "culture", aliases: ["meme", "memecoin", "meme coin"], ticker: ["MEME"], generic: true },
  { id: "parody", label: "Parody", group: "culture", aliases: ["parody", "spoof"], ticker: [], generic: true },
]

export const FAMILY_ROOTS = ["pepe", "doge", "shiba", "wojak", "bonk", "floki", "mog"] as const

const byId = new Map(CONCEPTS.map((concept) => [concept.id, concept]))

export function conceptById(id: string): Concept | undefined {
  return byId.get(id)
}

/** Longest aliases first so "super intelligence" wins over a shorter fragment. */
export const ALIASES = CONCEPTS.flatMap((concept) =>
  concept.aliases.map((alias) => ({ concept, alias })),
).sort((a, b) => b.alias.length - a.alias.length)
