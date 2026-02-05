#!/usr/bin/env python3
"""
RAG recall: Search agent memory for relevant context.
Usage: recall "query" [--limit N] [--json] [--verbose]
"""

import os
import sys
import argparse
import json

# Support custom paths via environment
CHROMA_DIR = os.environ.get("RECALL_CHROMA_DB", os.path.expanduser("~/.openclaw/chroma-db"))
VENV_PATH = os.environ.get("RECALL_VENV", os.path.expanduser("~/.openclaw/rag-env"))

# Activate the venv
sys.path.insert(0, os.path.join(VENV_PATH, "lib/python3.12/site-packages"))
# Also try python3.11, 3.10 for compatibility
for pyver in ["python3.11", "python3.10"]:
    alt_path = os.path.join(VENV_PATH, f"lib/{pyver}/site-packages")
    if os.path.exists(alt_path):
        sys.path.insert(0, alt_path)

try:
    import chromadb
    from sentence_transformers import SentenceTransformer
except ImportError as e:
    print(f"❌ Missing dependency: {e}", file=sys.stderr)
    print("Run 'npx jasper-recall setup' to install dependencies.", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Search agent memory")
    parser.add_argument("query", help="Search query")
    parser.add_argument("-n", "--limit", type=int, default=5, help="Number of results (default: 5)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show similarity scores")
    parser.add_argument("--public-only", action="store_true", help="Only search public/shared content (for sandboxed agents)")
    args = parser.parse_args()
    
    if not os.path.exists(CHROMA_DIR):
        print("❌ No index found. Run 'index-digests' first.", file=sys.stderr)
        sys.exit(1)
    
    # Load model and database
    model = SentenceTransformer('all-MiniLM-L6-v2')
    client = chromadb.PersistentClient(path=CHROMA_DIR)
    
    try:
        collection = client.get_collection("jasper_memory")
    except Exception:
        print("❌ Collection not found. Run 'index-digests' first.", file=sys.stderr)
        sys.exit(1)
    
    # Embed query
    query_embedding = model.encode([args.query])[0].tolist()
    
    # Search with optional public-only filter
    # Fetch extra results if filtering, since we'll post-filter
    fetch_limit = args.limit * 3 if args.public_only else args.limit
    
    query_params = {
        "query_embeddings": [query_embedding],
        "n_results": fetch_limit,
        "include": ["documents", "metadatas", "distances"]
    }
    
    results = collection.query(**query_params)
    
    # Post-filter for public-only mode
    if args.public_only and results['documents'][0]:
        filtered_docs = []
        filtered_metas = []
        filtered_dists = []
        
        for doc, meta, dist in zip(
            results['documents'][0],
            results['metadatas'][0],
            results['distances'][0]
        ):
            source = meta.get('source', '')
            visibility = meta.get('visibility', '')
            
            # Check if source is in shared/ folder OR has public visibility
            is_shared = 'shared/' in source
            is_public = visibility == 'public'
            
            # Reject if content contains [private] tag
            has_private_tag = '[private]' in doc.lower()
            
            if (is_shared or is_public) and not has_private_tag:
                filtered_docs.append(doc)
                filtered_metas.append(meta)
                filtered_dists.append(dist)
                
                if len(filtered_docs) >= args.limit:
                    break
        
        results['documents'][0] = filtered_docs
        results['metadatas'][0] = filtered_metas
        results['distances'][0] = filtered_dists
    
    if not results['documents'][0]:
        if args.json:
            print("[]")
        else:
            print(f"🔍 No results for: \"{args.query}\"")
        return
    
    if args.json:
        output = []
        for i, (doc, meta, dist) in enumerate(zip(
            results['documents'][0],
            results['metadatas'][0],
            results['distances'][0]
        )):
            output.append({
                "rank": i + 1,
                "source": meta.get('source', 'unknown'),
                "similarity": round(1 - dist, 3),  # Convert distance to similarity
                "content": doc
            })
        print(json.dumps(output, indent=2))
    else:
        print(f"🔍 Results for: \"{args.query}\"\n")
        
        for i, (doc, meta, dist) in enumerate(zip(
            results['documents'][0],
            results['metadatas'][0],
            results['distances'][0]
        )):
            similarity = 1 - dist
            score_str = f" ({similarity:.1%})" if args.verbose else ""
            source = meta.get('source', 'unknown')
            
            print(f"━━━ [{i+1}] {source}{score_str} ━━━")
            # Truncate long content
            content = doc[:500] + "..." if len(doc) > 500 else doc
            print(content)
            print()


if __name__ == "__main__":
    main()
