import anthropic
import json
import os
import requests
from typing import Dict, Any
from datetime import datetime

# Set your API key
client = anthropic.Anthropic()
                             

class EnsemblClient:
    def __init__(self, mcp_server_url="http://localhost:8000/mcp/ensembl", debug=False):
        self.mcp_server_url = mcp_server_url
        self.debug = debug
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")  # Get the API key from environment variables
        
    def query(self, question: str) -> str:
        # Start a new debug session
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        debug_log = {
            "question": question,
            "timestamp": datetime.now().isoformat()
        }
        
        # Describe the MCP tool to Claude
        mcp_tool_description = {
            "name": "ensembl_api",
            "description": "Access the Ensembl genomics database to retrieve information about genes, variants, sequences, and more.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "method": {
                        "type": "string",
                        "enum": [
                            # Current methods
                            "lookup_gene", 
                            "lookup_gene_by_symbol", 
                            "get_gene_sequence",
                            "get_variant_info", 
                            "search_genes",
                            
                            # New methods
                            "get_sequence_by_id",
                            "get_sequence_by_region",
                            "get_gene_tree",
                            "get_homology",
                            "get_genomic_alignment",
                            "get_variant_consequences",
                            "get_phenotype_by_gene",
                            "get_phenotype_by_region",
                            "get_xrefs_by_symbol",
                            "get_xrefs_by_id",
                            "get_species_info",
                            "get_assembly_info"
                        ],
                        "description": "The Ensembl API method to call"
                    },
                    "params": {
                        "type": "object",
                        "description": "Parameters for the API call"
                    }
                },
                "required": ["method", "params"]
            }
        }

        # System prompt to instruct Claude on using the MCP tool
        system_prompt = """
        You are a genomics assistant with expertise in molecular biology, genetics, and bioinformatics.
        You have access to the Ensembl API through a Model Context Protocol tool.
        When answering questions, you should:
        1. Consider if you need to retrieve data from the Ensembl database
        2. If so, call the appropriate method with the right parameters
        3. Interpret the results and provide a clear, educational response
        
        The Ensembl API supports data for many species, not just humans. Always consider which species
        the user is interested in, and specify the appropriate species parameter when making API calls.
        If the species isn't mentioned, you can assume human as the default.
        
        Available API methods:
        - lookup_gene: Get details about a gene by Ensembl ID (params: gene_id, species)
        - lookup_gene_by_symbol: Get details about a gene by gene symbol (params: symbol, species)
        - get_gene_sequence: Get the DNA sequence of a gene (params: gene_id, species)
        - get_variant_info: Get information about a genetic variant (params: variant_id, species)
        - search_genes: Search for genes matching a query (params: query, species)
        - get_sequence_by_id: Get sequence data for a given stable ID (params: id, species, mask, expand_3prime, expand_5prime)
        - get_sequence_by_region: Get genomic sequence for a specific region (params: region, species)
        - get_gene_tree: Get a gene tree for a gene tree stable identifier (params: id)
        - get_homology: Get homology (ortholog) information for a gene (params: id, species)
        - get_genomic_alignment: Get genomic alignments for a region (params: region, species)
        - get_variant_consequences: Get variant consequences using VEP (params: variant_id, species)
        - get_phenotype_by_gene: Get phenotype annotations for a gene (params: gene, species)
        - get_phenotype_by_region: Get phenotype annotations in a region (params: region, species)
        - get_xrefs_by_symbol: Get cross-references by gene symbol (params: symbol, species)
        - get_xrefs_by_id: Get cross-references by Ensembl ID (params: id)
        - get_species_info: Get information about available species
        - get_assembly_info: Get genome assembly information for a species (params: species)
        
        Be precise, clear, and educational in your responses.
        """
        
        # Make the request to Claude
        print(f"Querying Claude: {question}")
        response = client.messages.create(
            model="claude-3-5-sonnet-20240620",
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": question}],
            tools=[mcp_tool_description]
        )
        
        # Find text and tool use in the response
        text_content = None
        tool_use_content = None
        
        for content_item in response.content:
            if content_item.type == 'text':
                text_content = content_item.text
                debug_log["claude_text"] = text_content
            elif content_item.type == 'tool_use':
                tool_use_content = content_item
        
        # If we found a tool use, process it
        if tool_use_content:
            # Extract the tool use parameters
            input_data = tool_use_content.input
            method = input_data.get('method')
            params = input_data.get('params', {})
            
            debug_log["tool_call"] = {
                "method": method,
                "params": params
            }
            # import pdb
            # pdb.set_trace()
            print(f"Tool call: {method} with params: {params}")
            
            # Make the actual API call to the MCP server
            mcp_request = {
                "method": method,
                "params": params
            }
            
            try:
                # Add the API key to the headers
                headers = {
                    "Content-Type": "application/json",
                    "x-api-key": self.api_key  # Include the API key in the request
                }
                
                mcp_response = requests.post(
                    self.mcp_server_url,
                    json=mcp_request,
                    headers=headers
                )
                
                # Check if the request was successful
                mcp_response.raise_for_status()
                mcp_result = mcp_response.json()
                
                debug_log["ensembl_response"] = mcp_result
                print(f"Ensembl response received")
                # import pdb
                # pdb.set_trace()
                # Pass the result back to Claude for interpretation
                tool_response = json.dumps(mcp_result)
                
                # Create a message with the tool results
                final_response = client.messages.create(
                    model="claude-3-5-sonnet-20240620",
                    max_tokens=1024,
                    system=system_prompt,
                    messages=[
                        {"role": "user", "content": question},
                        {"role": "assistant", "content": [
                            {
                                "type": "tool_use",
                                "id": tool_use_content.id,
                                "name": "ensembl_api",
                                "input": input_data
                            }
                        ]},
                        {"role": "user", "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_use_content.id,
                                "content": tool_response
                            }
                        ]}
                    ]
                )

                # Get Claude's final response
                final_text = None
                for content in final_response.content:
                    if content.type == 'text':
                        final_text = content.text
                        debug_log["claude_final_response"] = final_text
                        break
                
                # Save debug info if debug is enabled
                if self.debug:
                    with open(f"debug_{session_id}.json", "w") as f:
                        json.dump(debug_log, f, indent=2)
                    
                    print(f"Debug info saved to debug_{session_id}.json")
                    return f"{final_text}\n\n[DEBUG] API method: {method}, species: {params.get('species', 'human')}"
                else:
                    return final_text
                
            except requests.exceptions.RequestException as e:
                error_msg = f"Error communicating with the Ensembl MCP server: {str(e)}"
                debug_log["error"] = error_msg
                
                if self.debug:
                    with open(f"debug_{session_id}.json", "w") as f:
                        json.dump(debug_log, f, indent=2)
                
                return error_msg
        
        # If no tool use was found, return the original response text
        if text_content:
            if self.debug:
                with open(f"debug_{session_id}.json", "w") as f:
                    json.dump(debug_log, f, indent=2)
                return f"{text_content}\n\n[DEBUG] No API call made"
            else:
                return text_content
                
        return "No response generated"