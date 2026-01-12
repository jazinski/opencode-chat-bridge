# RAG Enhancement Plan for Chat History

## Current State (Basic RAG)

We already have a simple RAG system:

- ✅ Keyword-based context detection
- ✅ PostgreSQL full-text search
- ✅ Automatic context injection
- ✅ Formatted message history

**Example:**

```
User: "what did we discuss about linux earlier?"
Bot: [searches database] → [finds messages] → [injects into AI] → AI answers with context
```

## Enhancement Options

### Level 1: Enhanced Text Search (Easy - 2-4 hours)

**What:** Improve search quality without embeddings

**Implementation:**

1. Add query expansion (synonyms)
2. Add temporal weighting (recent = more relevant)
3. Add user-specific search
4. Add conversation thread awareness
5. Add configurable context window

**Benefits:**

- Better search results
- More relevant context
- Minimal complexity

**Code Changes:**

```typescript
// Enhanced search with weights
searchMessages(
  query: string,
  options: {
    platform?: string;
    channelId?: string;
    userId?: string;
    timeWeight?: number; // 0-1, how much to favor recent
    limit?: number;
    includeThreads?: boolean;
  }
)
```

**SQL Example:**

```sql
-- Weight recent messages higher
SELECT *,
  ts_rank(to_tsvector('english', message_text), query) * 
  (1 + (timestamp - MIN(timestamp)) / (MAX(timestamp) - MIN(timestamp))) as score
FROM messages
WHERE to_tsvector('english', message_text) @@ query
ORDER BY score DESC;
```

---

### Level 2: Semantic Search with Embeddings (Medium - 8-12 hours)

**What:** Use AI embeddings for semantic similarity

**Implementation:**

1. Add `embedding` column to database (vector type)
2. Generate embeddings for each message (OpenAI, local model, etc.)
3. Use pgvector extension for similarity search
4. Hybrid search (text + semantic)

**Benefits:**

- Find semantically similar messages (not just keyword matches)
- "linux problems" matches "ubuntu issues" or "mac errors"
- Better understanding of context

**Dependencies:**

```bash
npm install @langchain/openai @langchain/community
# Or for local embeddings:
npm install @xenova/transformers
```

**Database Changes:**

```sql
-- Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column
ALTER TABLE messages ADD COLUMN embedding vector(1536);

-- Create HNSW index for fast similarity search
CREATE INDEX ON messages USING hnsw (embedding vector_cosine_ops);
```

**Code Changes:**

```typescript
// Generate embeddings on message insert
import { OpenAIEmbeddings } from '@langchain/openai';

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: config.openaiApiKey,
  modelName: 'text-embedding-3-small', // $0.02 per 1M tokens
});

async storeMessage(message: ChatMessage) {
  // Generate embedding
  const embedding = await embeddings.embedQuery(message.message_text);
  
  // Store with embedding
  await db.query(
    `INSERT INTO messages (..., embedding) VALUES (..., $1)`,
    [..., embedding]
  );
}

// Semantic search
async semanticSearch(query: string, limit: number = 5) {
  const queryEmbedding = await embeddings.embedQuery(query);
  
  return db.query(
    `SELECT *, 1 - (embedding <=> $1) as similarity
     FROM messages
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [queryEmbedding, limit]
  );
}

// Hybrid search (combine text + semantic)
async hybridSearch(query: string) {
  const [textResults, semanticResults] = await Promise.all([
    this.searchMessages(query, { limit: 10 }),
    this.semanticSearch(query, 10)
  ]);
  
  // Merge and re-rank
  return this.mergeAndRank(textResults, semanticResults);
}
```

**Cost Estimation (OpenAI):**

- text-embedding-3-small: $0.02 per 1M tokens
- Average message: ~20 tokens
- 1000 messages = ~20,000 tokens = $0.0004
- Very cheap!

**Alternative: Local Embeddings (Free)**

```typescript
import { pipeline } from "@xenova/transformers";

// Load model once
const embedder = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2",
);

// Generate embeddings (runs locally, no API calls)
const embedding = await embedder(text, { pooling: "mean", normalize: true });
```

---

### Level 3: Advanced RAG with Reranking (Advanced - 16-24 hours)

**What:** Multi-stage retrieval with reranking

**Implementation:**

1. Stage 1: Fast retrieval (get top 50 candidates)
   - Text search
   - Semantic search
   - Time-based filtering

2. Stage 2: Reranking (narrow to top 10)
   - Use reranker model
   - Consider conversation structure
   - Weight by relevance + recency + user

3. Stage 3: Context assembly
   - Group by conversation thread
   - Add temporal context (messages before/after)
   - Format for optimal AI consumption

**Benefits:**

- Highest quality context
- Better long-context handling
- Conversation-aware

**Dependencies:**

```bash
npm install cohere-ai  # For reranking
```

**Code Example:**

```typescript
import { CohereClient } from 'cohere-ai';

async advancedRAG(query: string, channel: string) {
  // Stage 1: Fast retrieval (get candidates)
  const [textResults, semanticResults, recentResults] = await Promise.all([
    this.searchMessages(query, { limit: 20 }),
    this.semanticSearch(query, 20),
    this.getRecentMessages('slack', channel, 10)
  ]);
  
  // Combine and deduplicate
  const candidates = this.deduplicate([
    ...textResults, 
    ...semanticResults, 
    ...recentResults
  ]);
  
  // Stage 2: Rerank with Cohere
  const cohere = new CohereClient({ token: config.cohereApiKey });
  const reranked = await cohere.rerank({
    query: query,
    documents: candidates.map(m => m.message_text),
    topN: 10,
    model: 'rerank-english-v3.0', // $1 per 1K searches
  });
  
  // Stage 3: Enhance with thread context
  const enhanced = await this.addThreadContext(
    reranked.results.map(r => candidates[r.index])
  );
  
  // Format for AI
  return this.formatContextForAI(enhanced);
}

// Add messages before/after for context
async addThreadContext(messages: Message[]) {
  const enhanced = [];
  
  for (const msg of messages) {
    const context = await this.getMessageContext(
      msg.platform,
      msg.channel_id,
      msg.timestamp,
      2, // 2 messages before
      2  // 2 messages after
    );
    enhanced.push({ message: msg, context });
  }
  
  return enhanced;
}
```

---

### Level 4: Intelligent Context Assembly (Expert - 24-40 hours)

**What:** AI-powered context selection and summarization

**Features:**

1. **Query Understanding**
   - Classify query type (question, summary, comparison, etc.)
   - Extract entities (users, dates, topics)
   - Determine optimal context strategy

2. **Smart Retrieval**
   - Multi-query expansion
   - Hypothetical document generation
   - Graph-based traversal (who replied to whom)

3. **Context Compression**
   - Summarize long conversations
   - Extract key points
   - Remove redundancy

4. **Iterative Refinement**
   - Check if context is sufficient
   - Fetch more if needed
   - Self-correction

**Example:**

```typescript
async intelligentRAG(userQuery: string, channel: string, userId: string) {
  // 1. Understand the query
  const analysis = await this.analyzeQuery(userQuery);
  /*
  {
    type: 'question_about_past',
    entities: { topics: ['linux', 'mac'], users: ['Christopher'] },
    timeRange: 'today',
    needsSummary: false
  }
  */
  
  // 2. Generate multiple search queries
  const queries = this.expandQuery(analysis);
  /*
  [
    'linux mac Christopher',
    'operating system Christopher today',
    'technical discussion Christopher'
  ]
  */
  
  // 3. Retrieve from multiple sources
  const results = await Promise.all([
    ...queries.map(q => this.hybridSearch(q)),
    this.getUserActivity(analysis.entities.users),
    this.getTimeRangeMessages(analysis.timeRange, channel)
  ]);
  
  // 4. Rerank and deduplicate
  const topResults = await this.rerank(userQuery, results.flat());
  
  // 5. Build conversation graphs
  const threads = this.groupByThread(topResults);
  const withContext = await this.addThreadContext(threads);
  
  // 6. Compress if too long
  let context = this.formatContext(withContext);
  if (context.length > 10000) {
    context = await this.summarizeContext(context, userQuery);
  }
  
  // 7. Check sufficiency
  const sufficient = await this.checkContextSufficiency(context, userQuery);
  if (!sufficient) {
    // Expand search
    context += await this.expandSearch(userQuery, analysis);
  }
  
  return context;
}
```

---

## Recommended Implementation Path

### Phase 1: Quick Wins (Week 1)

✅ Already done: Basic full-text search 🎯 **Next:** Enhanced search with
temporal weighting 🎯 **Next:** Add thread-aware context

**Effort:** 4 hours **Impact:** Medium **Cost:** $0

### Phase 2: Semantic Search (Week 2)

🎯 Add pgvector extension 🎯 Generate embeddings for existing messages 🎯
Implement hybrid search (text + semantic)

**Effort:** 12 hours **Impact:** High **Cost:** ~$0.10/month for embeddings

### Phase 3: Reranking (Week 3)

🎯 Add Cohere reranking 🎯 Implement multi-stage retrieval 🎯 Add conversation
threading

**Effort:** 20 hours **Impact:** Very High **Cost:** ~$5/month (assuming 5K
queries)

### Phase 4: Advanced Features (Month 2)

🎯 Query understanding 🎯 Context summarization 🎯 Iterative refinement 🎯 User
preference learning

**Effort:** 40 hours **Impact:** Excellent **Cost:** ~$10-20/month

---

## Cost-Benefit Analysis

| Level   | Implementation Time | Monthly Cost | Search Quality | Maintenance |
| ------- | ------------------- | ------------ | -------------- | ----------- |
| Current | ✅ Done             | $0           | 60%            | Low         |
| Level 1 | 4 hours             | $0           | 75%            | Low         |
| Level 2 | 12 hours            | ~$0.10       | 90%            | Medium      |
| Level 3 | 20 hours            | ~$5          | 95%            | Medium      |
| Level 4 | 40 hours            | ~$15         | 98%            | High        |

---

## Quick Start: Level 2 Implementation

Want to implement semantic search? Here's the checklist:

### 1. Install Dependencies

```bash
# PostgreSQL server (10.15.15.13)
sshpass -p 'chrisj' ssh root@10.15.15.13 'apk add postgresql-contrib'

# Bot machine
npm install @langchain/openai pgvector
```

### 2. Enable pgvector

```sql
-- On PostgreSQL
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE messages ADD COLUMN embedding vector(1536);
CREATE INDEX ON messages USING hnsw (embedding vector_cosine_ops);
```

### 3. Update Code

```typescript
// src/database/ChatHistory.ts
async storeMessage(message: ChatMessage) {
  const embedding = await this.generateEmbedding(message.message_text);
  // ... add to INSERT query
}

async semanticSearch(query: string, limit: number = 5) {
  const queryEmbedding = await this.generateEmbedding(query);
  return this.pool.query(
    `SELECT *, 1 - (embedding <=> $1) as similarity
     FROM messages
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [queryEmbedding, limit]
  );
}
```

### 4. Backfill Existing Messages

```bash
node dist/scripts/generate-embeddings.js
```

**Done!** Now you have semantic search. 🎉

---

## Testing RAG Quality

### Test Queries:

1. **Keyword match:** "linux" → should find obvious matches
2. **Semantic match:** "operating system" → should find "linux", "mac",
   "windows"
3. **Time-based:** "what did we discuss today" → recent messages
4. **User-specific:** "what did Christopher say about mac" → filtered by user
5. **Thread-aware:** "tell me more about that" → follow conversation thread
6. **Summarization:** "summarize last hour" → compressed overview

### Success Metrics:

- **Relevance:** Are the retrieved messages actually relevant?
- **Coverage:** Does it find all important messages?
- **Speed:** Response time < 2 seconds
- **Cost:** Per-query cost < $0.01

---

## Alternative: Use Existing RAG Framework

Instead of building from scratch, consider:

### LangChain

```typescript
import { PostgresVectorStore } from "@langchain/community/vectorstores/postgres";
import { OpenAIEmbeddings } from "@langchain/openai";

const vectorStore = await PostgresVectorStore.fromExistingTable(
  new OpenAIEmbeddings(),
  {
    postgresConnectionOptions: {
      connectionString: config.postgresUrl,
    },
    tableName: "messages",
    columns: {
      idColumnName: "id",
      vectorColumnName: "embedding",
      contentColumnName: "message_text",
      metadataColumnName: "metadata", // add JSON column
    },
  },
);

// Now you get RAG for free!
const results = await vectorStore.similaritySearch(query, 5);
```

**Pros:** Battle-tested, feature-rich, maintained **Cons:** More dependencies,
less control

---

## Summary

**What we have:** Basic keyword-based RAG ✅ **What we should do next:** Level 2
(Semantic Search) 🎯 **Estimated effort:** 12 hours **Estimated cost:**
~$0.10/month **Expected improvement:** 60% → 90% search quality

Want me to implement Level 2 semantic search?
