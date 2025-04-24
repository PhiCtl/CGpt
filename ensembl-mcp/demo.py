#!/usr/bin/env python3
from dotenv import load_dotenv
import os
# Load .env BEFORE importing anything else
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), 'ensembl_mcp_server', '.env'))
print("ANTHROPIC_API_KEY loaded:", os.getenv("ANTHROPIC_API_KEY"))

from client.ensembl_client import EnsemblClient

def main():
    # Create the client
    client = EnsemblClient()
    
    print("Ensembl Genomics Assistant")
    print("==========================")
    print("Ask questions about genes, variants, and genomics.")
    print("Type 'exit' to quit.\n")
    
    # Run the interactive loop
    while True:
        # Get user question
        question = input("\nYour question: ")
        
        # Check if user wants to exit
        if question.lower() in ["exit", "quit", "q"]:
            break
            
        # Skip empty questions
        if not question.strip():
            continue
            
        print("\nThinking...\n")
        
        try:
            # Get response from Claude
            response = client.query(question)
            print(response)
        except Exception as e:
            print(f"Error: {str(e)}")
    
    print("\nGoodbye!")

if __name__ == "__main__":
    main()