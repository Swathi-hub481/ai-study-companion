import { env } from "@/lib/config";
import { AiError } from "@/lib/errors";
import { estimateTokens } from "@/lib/ai/telemetry";
import type {
  AIProvider,
  EmbedRequest,
  EmbedResult,
  StructuredRequest,
  StructuredResult,
  TextChunk,
  TextRequest,
  TextResult,
  TokenUsage,
} from "@/lib/ai/types";

/**
 * Deterministic, offline AI provider.
 *
 * Purpose: let the whole application, its test suite, and CI run with no API key and
 * no network. Output is stable for a given input, so tests can assert on it.
 *
 * Two deliberate properties:
 *  - Structured output is validated against the caller's own Zod schema before it is
 *    returned. The mock therefore cannot drift out of sync with the contract, which
 *    is what makes it trustworthy for testing the features built on top of it.
 *  - Unknown schema names throw. Silently inventing a shape would let a feature ship
 *    with an unregistered mock and only fail once a real model was wired in.
 */

// --- Deterministic pseudo-randomness ----------------------------------------

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/** mulberry32 — small, fast, and stable across runs and platforms. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Mock structured responses ----------------------------------------------

type StructuredFactory = (request: TextRequest) => unknown;

const STRUCTURED_RESPONSES: Record<string, StructuredFactory> = {
  ConceptExtraction: (request) => {
    const random = createRandom(hashString(request.prompt));
    const count = 2 + Math.floor(random() * 3);

    return {
      concepts: Array.from({ length: count }, (_, index) => ({
        name: `Mock Concept ${index + 1}`,
        description:
          `Placeholder concept ${index + 1}, generated deterministically by the mock provider ` +
          `for a prompt of ${request.prompt.length} characters.`,
        importance: Number((0.4 + random() * 0.6).toFixed(2)),
        relatedConcepts: index === 0 ? [] : [`Mock Concept ${index}`],
      })),
    };
  },

  /**
   * The prompt states the required question type, so the mock can honour it rather than
   * always inventing a multiple-choice question — which is what lets the quiz flow be
   * tested end to end offline.
   */
  QuizQuestion: (request) => {
    if (!/MULTIPLE_CHOICE/.test(request.prompt)) {
      return {
        prompt:
          "In your own words, explain the concept and why it matters. " +
          "(deterministic mock open-ended question)",
        options: null,
        correctAnswer: null,
        explanation: null,
      };
    }

    return {
      prompt: `Which statement best describes the concept? (deterministic mock question for a prompt of ${request.prompt.length} characters)`,
      options: [
        { id: "a", text: "The statement that is actually correct." },
        { id: "b", text: "A plausible but incorrect statement." },
        { id: "c", text: "Another plausible but incorrect statement." },
        { id: "d", text: "An obviously incorrect statement." },
      ],
      correctAnswer: "a",
      explanation: "Option A is correct. The others are plausible but wrong.",
    };
  },

  /**
   * Grades echo the concept named in the prompt so the resulting evidence can be
   * attributed, and the feedback names what is missing rather than only scoring.
   */
  OpenEndedGrade: (request) => {
    const random = createRandom(hashString(request.prompt));
    const concept = /^Concept:\s*(.+)$/m.exec(request.prompt)?.[1]?.trim() || "the concept";

    return {
      understanding: Number((0.6 + random() * 0.3).toFixed(2)),
      accuracy: Number((0.6 + random() * 0.3).toFixed(2)),
      relevance: Number((0.6 + random() * 0.3).toFixed(2)),
      conceptsCovered: [concept],
      conceptsMissing: [`the reasoning behind ${concept}`],
      reasoning:
        "Deterministic mock reasoning: the answer named the concept but did not justify why it holds.",
      feedback:
        `You correctly identified ${concept}, which is the right idea. ` +
        `What is missing is the reasoning behind it — a complete answer would explain why it holds, not only what it is.`,
    };
  },

  /**
   * Echoes a concept named in the prompt so recommendation → concept linking is
   * exercised, rather than every suggestion arriving unattached.
   */
  Recommendations: (request) => {
    const random = createRandom(hashString(request.prompt));
    const concept = /^- (.+?) \(mastery /m.exec(request.prompt)?.[1]?.trim() || null;

    return {
      recommendations: [
        {
          title: concept ? `Review ${concept}` : "Review your weakest concept",
          body:
            "Revisit the material, then take a short quiz to confirm the idea has stuck. " +
            "(deterministic mock recommendation)",
          reason: concept
            ? `${concept} has the lowest mastery in this project with the least recent practice.`
            : "No concept-level evidence was available yet.",
          priority: Number((0.6 + random() * 0.4).toFixed(2)),
          conceptName: concept,
        },
        {
          title: "Take a short quiz",
          body:
            "A few questions will confirm what has actually stuck. " +
            "(deterministic mock recommendation)",
          reason: "Assessment history is the strongest signal available for this project.",
          priority: 0.5,
          conceptName: null,
        },
      ],
    };
  },

  /** A short, self-describing note — deliberately not a transcript. */
  ContextSummary: (request) => ({
    summary:
      `Deterministic mock context for a prompt of ${request.prompt.length} characters: ` +
      "the learner has worked through the project's material with uneven mastery across concepts, " +
      "and responds well to concrete worked examples before abstract definitions.",
  }),

  /** Optimistic but explained, so the harness reports a pass it can justify. */
  EvalGrade: (request) => ({
    score: 0.9,
    verdict: "The artefact satisfies the criterion.",
    notes:
      `Deterministic mock evaluation of a prompt of ${request.prompt.length} characters: ` +
      "the artefact is consistent with the reference material provided and contains no unsupported claims.",
  }),
};

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  private usage(prompt: string, completion: string): TokenUsage {
    return {
      promptTokens: estimateTokens(prompt),
      completionTokens: estimateTokens(completion),
      estimated: true,
    };
  }

  async generateText(request: TextRequest): Promise<TextResult> {
    const text =
      `Mock response (provider=mock, model=${request.model}). ` +
      `The prompt contained ${request.prompt.length} characters. ` +
      `This text exists so the application can be exercised without a real model.`;

    return { text, usage: this.usage(request.prompt, text) };
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const factory = STRUCTURED_RESPONSES[request.schemaName];

    if (!factory) {
      throw new AiError(
        `No mock response registered for schema "${request.schemaName}". ` +
          `Register one in lib/ai/providers/mock.ts so the mock cannot silently drift from the contract.`,
      );
    }

    const candidate = factory(request);

    // Validate before returning: the mock must honour the same contract a real
    // provider is held to, or tests built on it prove nothing.
    const value = request.schema.parse(candidate);

    return {
      value,
      usage: this.usage(request.prompt, JSON.stringify(candidate)),
    };
  }

  /**
   * Deterministic unit vectors.
   *
   * Identical text always yields an identical embedding (cosine similarity 1.0), and
   * different text yields an effectively unrelated one. That is enough to exercise
   * retrieval plumbing; it says nothing about semantic quality, which is why real
   * retrieval evaluation runs against a real embedding model.
   */
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const dimensions = env.AI_EMBED_DIMENSIONS;

    const embeddings = request.input.map((text) => {
      const random = createRandom(hashString(text));
      const vector: number[] = [];

      for (let index = 0; index < dimensions; index += 1) {
        vector.push(random() * 2 - 1);
      }

      const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
      return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
    });

    return {
      embeddings,
      usage: {
        promptTokens: request.input.reduce((total, text) => total + estimateTokens(text), 0),
        completionTokens: 0,
        estimated: true,
      },
    };
  }

  async *streamText(request: TextRequest): AsyncGenerator<TextChunk, void, undefined> {
    const { text } = await this.generateText(request);
    const words = text.split(" ");

    for (let index = 0; index < words.length; index += 1) {
      yield { delta: index === 0 ? words[index] : ` ${words[index]}` };
    }
  }
}
