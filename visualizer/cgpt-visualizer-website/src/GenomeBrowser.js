import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import chromosomeData from './data/chromosome_data.json';
import ChatbotWidget from './ChatbotWidget';

const geneColors = [
  '#3498db', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6',
  '#e67e22', '#1abc9c', '#e91e63', '#cddc39', '#00bfff'
];

const baseColors = {
  A: '#1f77b4', // blue
  C: '#2ca02c', // green
  T: '#d62728', // red
  G: '#ff7f0e'  // orange
};

// Define AND EXPORT the data object using a NAMED export
export const realChromosome = {
  name: chromosomeData.name,
  length: chromosomeData.length,
  genes: []
};

const realSequence = chromosomeData.sequence.toUpperCase().replace(/[^ACGT]/g, ''); // Ensure clean sequence

window._realChromosome = realChromosome;
window._realSequence = realSequence;

// Assign color to gene by index (alternating from 10 colors)
function getGeneColor(index) {
  return geneColors[index % geneColors.length];
}

function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Add a simple debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Add a simple throttle function
function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

function GenomeBrowser({ genes }) {
  // --- Autocomplete search state ---
  const [searchInput, setSearchInput] = useState("");
  const [suggestions, setSuggestions] = useState({ gene_ids: [], descriptions: [] });
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Debounced fetch for autocomplete
  useEffect(() => {
    if (!searchInput) {
      setSuggestions({ gene_ids: [], descriptions: [] });
      return;
    }
    const fetchSuggestions = debounce(async (query) => {
      try {
        const res = await fetch(`http://localhost:5001/api/v1/search/autocomplete?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setSuggestions(data);
      } catch (err) {
        setSuggestions({ gene_ids: [], descriptions: [] });
      }
    }, 200);
    fetchSuggestions(searchInput);
    // eslint-disable-next-line
  }, [searchInput]);

  function handleSearchInputChange(e) {
    setSearchInput(e.target.value);
    setShowSuggestions(true);
  }

  function handleSuggestionSelect(suggestion) {
    setSearchInput(suggestion.type === 'gene_id' ? suggestion.value : suggestion.value);
    setShowSuggestions(false);
    if (suggestion.type === 'gene_id') {
      // Find and select the gene
      const gene = genes.find(g => g.id === suggestion.value);
      if (gene) {
        setSelectedGene(gene);
        // Optionally zoom to gene
        setZoomRegion([gene.start, gene.end]);
      }
    } else if (suggestion.type === 'desc_keyword') {
      // For now, just log. You could display a modal or list of genes.
      // eslint-disable-next-line no-console
      console.log('Genes for keyword', suggestion.value, suggestion.genes);
      // Optionally: highlight all genes with this keyword, or show a modal
    }
  }

  function MostProbableAnnotationDisplay({ gene, chromosome }) {
    const [annotation, setAnnotation] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const chromosomeName = chromosome.name;
    const geneName = gene.id.replace(/^gene-/, '');

    useEffect(() => {
      if (!gene) {
        setAnnotation(null);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      fetch(`http://localhost:5001/api/v1/annotations/most_probable?chromosome=${encodeURIComponent(chromosomeName)}&gene_name=${encodeURIComponent(geneName)}`)
        .then(res => {
          console.log('Annotation response:', res);
          if (!res.ok) throw new Error("No annotation found");
          return res.json();
        })
        .then(data => {
          console.log('Annotation data:', data);
          setAnnotation(data);
          setLoading(false);
        })
        .catch(err => {
          console.error('Annotation fetch error:', err);
          setAnnotation(null);
          setError("No annotation found");
          setLoading(false);
        });
    }, [gene, chromosome]);

    if (!gene) return null;
    return (
      <div style={{ marginTop: 18, padding: '12px 16px', border: '1px solid #eee', borderRadius: 8, background: '#fafbfc' }}>
        <b>Most Probable Annotation:</b><br />
        {loading && <span style={{ color: '#888' }}>Loading...</span>}
        {error && <span style={{ color: '#c00' }}>{error}</span>}
        {annotation && (
          <div style={{ marginTop: 6, fontSize: 15 }}>
            <div><b>Type:</b> {annotation.type}</div>
            <div><b>Confidence:</b> {Number(annotation.PPV).toFixed(3)}</div>
            <div><b>Gene Ontology:</b> {annotation.id}</div>
            <div><b>Description:</b> {annotation.desc}</div>
            {/* Show more fields as needed */}
          </div>
        )}
      </div>
    );
  }

  realChromosome.genes = genes;

  const overviewRef = useRef();
  const detailRef = useRef();
  const zoomRef = useRef();
  const xChromosomeRef = useRef(); // Reference for X chromosome visualization
  // Initialize state with the length from the JSON data
  const [zoomRegion, setZoomRegion] = useState([0, realChromosome.length]);
  const [hoveredGene, setHoveredGene] = useState(null);
  const [selectedGene, setSelectedGene] = useState(null);
  const [editableStart, setEditableStart] = useState(Math.round(zoomRegion[0]).toString());
  const [editableEnd, setEditableEnd] = useState(Math.round(zoomRegion[1]).toString());

  // Add optimized lookup maps at the top of the component
  const geneIndexMap = useRef(new Map());

  // Populate the lookup map when genes change
  useEffect(() => {
    // Create indices map for faster lookups
    const newMap = new Map();
    if (genes && genes.length) {
      genes.forEach((gene, index) => {
        newMap.set(gene.id, index);
      });
    }
    geneIndexMap.current = newMap;
  }, [genes]);

  // Add a function to efficiently filter visible genes based on current zoom
  const getVisibleGenes = useRef((genes, start, end, buffer = 0.2) => {
    // Add a buffer zone to prevent pop-in/out when panning
    const bufferAmount = (end - start) * buffer;
    const visibleStart = Math.max(0, start - bufferAmount);
    const visibleEnd = end + bufferAmount;

    // Filter genes that are visible in the current zoom region (with buffer)
    return genes.filter(gene =>
      (gene.start <= visibleEnd && gene.end >= visibleStart)
    );
  });

  // Create throttled state update handlers for mouse interactions
  const throttledSetHoveredGene = useRef(
    throttle((gene) => {
      setHoveredGene(gene);
    }, 50) // 50ms throttle for smoother performance
  ).current;

  // --- D3 Zoom Setup: Only once on mount ---
  useEffect(() => {
    const width = window.innerWidth;
    const detailHeight = 80;
    const margin = { left: 60, right: 60 };
    const minZoom = 1;
    // Maximum zoom: allow 1bp per 1.25px (double again)
    const visiblePixels = width - margin.left - margin.right;
    const minBpWindow = visiblePixels / 20; // at max zoom, show 1bp per 1.25px
    const maxZoom = realChromosome.length / minBpWindow;
    const zoom = d3.zoom()
      .scaleExtent([minZoom, maxZoom])
      .translateExtent([[margin.left, 0], [width - margin.right, detailHeight]])
      .extent([[margin.left, 0], [width - margin.right, detailHeight]])
      .on('zoom', (event) => {
        const t = event.transform;
        const x = d3.scaleLinear().domain([0, realChromosome.length]).range([margin.left, width - margin.left - margin.right]);
        const newDomain = t.rescaleX(x).domain();
        let newRegion = [
          Math.max(0, newDomain[0]),
          Math.min(realChromosome.length, newDomain[1])
        ];
        if (newRegion[0] <= 0 + 1 && newRegion[1] >= realChromosome.length - 1) {
          newRegion = [0, realChromosome.length];
        }
        // Only update if region actually changed, to avoid infinite loop
        setZoomRegion(prev => {
          if (
            Math.abs(newRegion[0] - prev[0]) > 0.5 ||
            Math.abs(newRegion[1] - prev[1]) > 0.5
          ) {
            return newRegion;
          }
          return prev;
        });
      });
    d3.select(detailRef.current).call(zoom);
    zoomRef.current = zoom;
    d3.select(detailRef.current).call(zoom.transform, d3.zoomIdentity);
    d3.select(detailRef.current).on('dblclick.zoom', null);
    d3.select(detailRef.current).on('dblclick.reset', () => {
      d3.select(detailRef.current).transition().duration(300).call(zoom.transform, d3.zoomIdentity);
      setZoomRegion([0, realChromosome.length]);
    });
    // eslint-disable-next-line
  }, []);

  // Synchronize d3 zoom transform with zoomRegion changes (from slider/tool)
  useEffect(() => {
    if (!zoomRef.current || !detailRef.current) return;
    const width = window.innerWidth;
    const margin = { left: 60, right: 60 };
    const x = d3.scaleLinear().domain([0, realChromosome.length]).range([margin.left, width - margin.left - margin.right]);
    const k = (realChromosome.length / (zoomRegion[1] - zoomRegion[0]));
    const tx = -x(zoomRegion[0]) * k + margin.left;
    const transform = d3.zoomIdentity.translate(tx, 0).scale(k);
    // Only update transform if not already at this zoom
    const currentTransform = d3.zoomTransform(detailRef.current);
    if (
      Math.abs(currentTransform.k - k) > 0.01 ||
      Math.abs(currentTransform.x - tx) > 0.5
    ) {
      d3.select(detailRef.current).call(zoomRef.current.transform, transform);
    }
  }, [zoomRegion]);

  // Update editable fields when zoom region changes
  useEffect(() => {
    setEditableStart(Math.round(zoomRegion[0]).toString());
    setEditableEnd(Math.round(zoomRegion[1]).toString());
  }, [zoomRegion]);

  // --- Draw both SVGs whenever zoomRegion changes ---
  useEffect(() => {
    // Get available width accounting for chat panel
    const availableWidth = window.innerWidth;
    const overviewHeight = 80;
    const detailHeight = 100;
    const margin = { left: 60, right: 60 };

    // -- OVERVIEW BAR --
    d3.select(overviewRef.current).selectAll('*').remove();
    const overviewSvg = d3.select(overviewRef.current)
      .attr('width', availableWidth)
      .attr('height', overviewHeight)
      .style('background', '#f8f8fa')
      .on('click', function (event) {
        // Only clear selection if click is on the SVG background
        if (event.target === this) setSelectedGene(null);
      });
    const xOverview = d3.scaleLinear()
      .domain([0, realChromosome.length])
      .range([margin.left, availableWidth - margin.right]);
    // Chromosome bar (move lower)
    const overviewBarY = 32; // was 12, now lower 
    overviewSvg.append('rect')
      .attr('x', margin.left)
      .attr('y', overviewBarY)
      .attr('width', availableWidth - margin.left - margin.right)
      .attr('height', 16)
      .attr('rx', 10)
      .attr('fill', '#cccccc');

    // Genes
    overviewSvg.selectAll('.gene')
      .data(realChromosome.genes) // Use realChromosome.genes
      .enter()
      .append('rect')
      .attr('class', 'gene')
      .attr('x', d => xOverview(d.start))
      .attr('y', overviewBarY + 1)
      .attr('width', d => Math.max(1, xOverview(d.end) - xOverview(d.start)))
      .attr('height', 14)
      .attr('fill', (d, i) => getGeneColor(i))
      .attr('rx', 5)
      .style('opacity', d => selectedGene?.id === d.id ? 1 : 0) // Only show selected gene
      .attr('stroke', d => selectedGene?.id === d.id ? '#000' : 'none')
      .attr('stroke-width', d => selectedGene?.id === d.id ? 2 : 0)
      .attr('cursor', 'pointer')
      .style('pointer-events', 'all')
      .on('mouseover', function (event, d) {
        throttledSetHoveredGene(d);

        // Don't change opacity on hover anymore, only selection matters
        d3.select(this)
          .attr('stroke', '#000')
          .attr('stroke-width', 1);
      })
      .on('mouseout', function (event, d) {
        throttledSetHoveredGene(null);

        // Only show selected gene
        d3.select(this)
          .style('opacity', selectedGene?.id === d.id ? 1 : 0)
          .attr('stroke', selectedGene?.id === d.id ? '#000' : 'none')
          .attr('stroke-width', selectedGene?.id === d.id ? 2 : 0);
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        setSelectedGene(d);
      });

    // Red rectangle for zoom region
    const isFullView = zoomRegion[0] <= 0 + 1 && zoomRegion[1] >= realChromosome.length - 1;

    // Draggable zoom rectangle
    const dragZoomRect = d3.drag()
      .on('start', function (event) {
        d3.select(this).attr('cursor', 'grabbing');
        // Store the initial click offset from the rectangle's left edge
        const rectX = parseFloat(d3.select(this).attr('x'));
        d3.select(this).attr('data-offset', event.x - rectX);
      })
      .on('drag', function (event) {
        if (isFullView) return; // Don't drag when showing full view

        const width = parseFloat(d3.select(this).attr('width'));
        const offset = parseFloat(d3.select(this).attr('data-offset')) || 0;

        // Apply the offset to maintain grab position
        const adjustedX = event.x - offset;

        const minX = margin.left;
        const maxX = availableWidth - margin.right - width;

        // Constrain to chromosome boundaries
        let newX = Math.max(minX, Math.min(maxX, adjustedX));

        // Update rectangle position
        d3.select(this).attr('x', newX);

        // Calculate new zoom region based on drag position
        const newStart = xOverview.invert(newX);
        const newEnd = xOverview.invert(newX + width);

        // Update zoom region if significantly different (avoid unnecessary updates)
        if (Math.abs(newStart - zoomRegion[0]) > 1 || Math.abs(newEnd - zoomRegion[1]) > 1) {
          setZoomRegion([newStart, newEnd]);
        }
      })
      .on('end', function () {
        d3.select(this).attr('cursor', 'grab');
      });

    const zoomRect = overviewSvg.append('rect')
      .attr('class', 'zoom-rect')
      .attr('x', isFullView ? margin.left : xOverview(zoomRegion[0]))
      .attr('y', overviewBarY - 5)
      .attr('width', isFullView ? (availableWidth - margin.left - margin.right) : (xOverview(zoomRegion[1]) - xOverview(zoomRegion[0])))
      .attr('height', 26)
      .attr('fill', 'rgba(255, 0, 0, 0.1)')  // Semi-transparent red fill
      .attr('stroke', 'red')
      .attr('stroke-width', 2)
      .attr('cursor', 'grab')
      .style('pointer-events', 'all');  // Make sure pointer events work on the entire rectangle

    // Add drag behavior if not showing full view
    if (!isFullView) {
      zoomRect.call(dragZoomRect);
    }

    // Make genes easier to select in overview
    overviewSvg.selectAll('.gene-hitbox')
      .data(realChromosome.genes)
      .enter()
      .append('rect')
      .attr('class', 'gene-hitbox')
      .attr('x', d => Math.max(margin.left, xOverview(d.start) - 5))
      .attr('y', overviewBarY - 4)
      .attr('width', d => Math.max(10, xOverview(d.end) - xOverview(d.start) + 10))
      .attr('height', 24)
      .attr('fill', 'transparent')
      .attr('cursor', 'pointer')
      .style('pointer-events', 'all')
      .on('mouseover', function (event, d) {
        throttledSetHoveredGene(d);

        // Only highlight the stroke, don't change opacity
        overviewSvg.selectAll('.gene')
          .filter(g => g.id === d.id)
          .attr('stroke', '#000')
          .attr('stroke-width', 1);
      })
      .on('mouseout', function (event, d) {
        throttledSetHoveredGene(null);

        // Only show selected gene
        overviewSvg.selectAll('.gene')
          .filter(g => g.id === d.id)
          .style('opacity', selectedGene?.id === d.id ? 1 : 0)
          .attr('stroke', selectedGene?.id === d.id ? '#000' : 'none')
          .attr('stroke-width', selectedGene?.id === d.id ? 2 : 0);
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        setSelectedGene(d);
      });

    // --- SCALES for + strand (overview bar, above the bar) ---
    const overviewTicks = xOverview.ticks(10).filter(t => t >= 0 && t <= realChromosome.length);
    overviewSvg.selectAll('.overview-scale-plus')
      .data(overviewTicks)
      .enter()
      .append('line')
      .attr('class', 'overview-scale-plus')
      .attr('x1', d => xOverview(d))
      .attr('x2', d => xOverview(d))
      .attr('y1', overviewBarY - 12)
      .attr('y2', overviewBarY - 8)
      .attr('stroke', '#555')
      .attr('stroke-width', 1);
    overviewSvg.selectAll('.overview-scale-plus-label')
      .data(overviewTicks)
      .enter()
      .append('text')
      .attr('class', 'overview-scale-plus-label')
      .attr('x', d => xOverview(d))
      .attr('y', overviewBarY - 16)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', '#555')
      .text(d => numberWithCommas(Math.round(d)));

    // -- DETAIL BAR --
    d3.select(detailRef.current).selectAll('*').remove();
    const detailSvg = d3.select(detailRef.current)
      .attr('width', availableWidth)
      .attr('height', detailHeight + 40)
      .style('background', '#fff')
      .on('click', function (event) {
        if (event.target === this) setSelectedGene(null);
      });
    // Scales
    const xDetail = d3.scaleLinear()
      .domain(zoomRegion)
      .range([margin.left, availableWidth - margin.right]);
    // Add a clipPath for the chromosome bar area (now tall enough for genes below)
    const chrBarY = 20;
    const chrBarH = 24;
    const geneLineGap = 24; // Increased from 10 to add more space
    const clipHeight = chrBarH + geneLineGap * 2 + 18 + 12 + 20; // Increased height for more space
    detailSvg.append('clipPath')
      .attr('id', 'detail-clip')
      .append('rect')
      .attr('x', margin.left)
      .attr('y', chrBarY)
      .attr('width', availableWidth - margin.left - margin.right)
      .attr('height', clipHeight);
    // Chromosome bar
    // Remove rounded corners except at chromosome ends
    const isAtChromStart = Math.abs(zoomRegion[0] - 0) < 1;
    const isAtChromEnd = Math.abs(zoomRegion[1] - realChromosome.length) < 1;
    let rxLeft = isAtChromStart ? 10 : 0;
    let rxRight = isAtChromEnd ? 10 : 0;
    // SVG only supports one rx, so we use a path for custom corners
    if (rxLeft !== rxRight) {
      // Draw as path for mixed corners
      const barX = margin.left;
      const barW = availableWidth - margin.left - margin.right;
      let d = '';
      d += `M${barX + rxLeft},${chrBarY}`;
      d += `H${barX + barW - rxRight}`;
      if (rxRight) {
        d += `A${rxRight},${rxRight} 0 0 1 ${barX + barW},${chrBarY + rxRight}`;
        d += `V${chrBarY + chrBarH - rxRight}`;
        d += `A${rxRight},${rxRight} 0 0 1 ${barX + barW - rxRight},${chrBarY + chrBarH}`;
      } else {
        d += `V${chrBarY + chrBarH}`;
      }
      d += `H${barX + rxLeft}`;
      if (rxLeft) {
        d += `A${rxLeft},${rxLeft} 0 0 1 ${barX},${chrBarY + chrBarH - rxLeft}`;
        d += `V${chrBarY + rxLeft}`;
        d += `A${rxLeft},${rxLeft} 0 0 1 ${barX + rxLeft},${chrBarY}`;
      } else {
        d += `V${chrBarY}`;
      }
      d += 'Z';
      detailSvg.append('path')
        .attr('d', d)
        .attr('fill', '#cccccc')
        .attr('class', 'chr-bar');
    } else {
      detailSvg.append('rect')
        .attr('class', 'chr-bar')
        .attr('x', margin.left)
        .attr('y', chrBarY)
        .attr('width', availableWidth - margin.left - margin.right)
        .attr('height', chrBarH)
        .attr('rx', rxLeft)
        .attr('fill', '#cccccc');
    }

    // --- TRACK LINES for gene rows ---
    detailSvg.append('line')
      .attr('x1', margin.left)
      .attr('x2', availableWidth - margin.right)
      .attr('y1', 54)
      .attr('y2', 54)
      .attr('stroke', '#b0b0b0')
      .attr('stroke-width', 1);
    detailSvg.append('line')
      .attr('x1', margin.left)
      .attr('x2', availableWidth - margin.right)
      .attr('y1', 84) // Increased from 72 to add more space
      .attr('y2', 84) // Increased from 72 to add more space
      .attr('stroke', '#b0b0b0')
      .attr('stroke-width', 1);

    // --- GENES WITH ARROWS ---
    // Helper to draw an arrow for a gene (SVG path)
    function geneArrowPath(x1, x2, y, height, strand) {
      const w = Math.abs(x2 - x1);
      if (w < 12) return `M${x1},${y} h${w}`; // too small for arrow
      if (strand === '+') {
        return `M${x1},${y} h${w - 7} l4,-5 l0,10 l-4,-5 h7`;
      } else {
        return `M${x2},${y} h-${w - 7} l-4,-5 l0,10 l4,-5 h-7`;
      }
    }
    // Draw + strand genes as arrows
    const plusGenes = getVisibleGenes.current(realChromosome.genes, zoomRegion[0], zoomRegion[1]);
    detailSvg.selectAll('.gene-plus-arrow')
      .data(plusGenes.filter(g => g.strand === '+'))
      .enter()
      .append('path')
      .attr('class', 'gene-plus-arrow')
      .attr('d', (d, i) => geneArrowPath(xDetail(d.start), xDetail(d.end), 54, 12, '+'))
      .attr('stroke', (d, i) => getGeneColor(geneIndexMap.current.get(d.id)))
      .attr('stroke-width', 8)
      .attr('fill', 'none')
      .attr('clip-path', 'url(#detail-clip)')
      .style('opacity', d => (selectedGene?.id === d.id || hoveredGene?.id === d.id) ? 1 : 0.8) // Opacity for hover/select
      .attr('stroke', d => (selectedGene?.id === d.id || hoveredGene?.id === d.id) ? '#000' : getGeneColor(geneIndexMap.current.get(d.id)))
      .on('mouseover', function (event, d) {
        throttledSetHoveredGene(d);
      })
      .on('mouseout', function () {
        throttledSetHoveredGene(null);
      })
      .on('click', function (event, d) {
        event.stopPropagation(); // Prevent triggering background click
        setSelectedGene(d);
      });
    // Draw - strand genes as arrows
    const minusGenes = getVisibleGenes.current(realChromosome.genes, zoomRegion[0], zoomRegion[1]);
    detailSvg.selectAll('.gene-minus-arrow')
      .data(minusGenes.filter(g => g.strand === '-'))
      .enter()
      .append('path')
      .attr('class', 'gene-minus-arrow')
      .attr('d', (d, i) => geneArrowPath(xDetail(d.start), xDetail(d.end), 84, 12, '-')) // Increased from 72 to add more space
      .attr('stroke', (d, i) => getGeneColor(geneIndexMap.current.get(d.id)))
      .attr('stroke-width', 8)
      .attr('fill', 'none')
      .attr('clip-path', 'url(#detail-clip)')
      .style('opacity', d => (selectedGene?.id === d.id || hoveredGene?.id === d.id) ? 1 : 0.8) // Opacity for hover/select
      .attr('stroke', d => (selectedGene?.id === d.id || hoveredGene?.id === d.id) ? '#000' : getGeneColor(geneIndexMap.current.get(d.id)))
      .on('mouseover', function (event, d) {
        throttledSetHoveredGene(d);
      })
      .on('mouseout', function () {
        throttledSetHoveredGene(null);
      })
      .on('click', function (event, d) {
        event.stopPropagation(); // Prevent triggering background click
        setSelectedGene(d);
      });

    // Add hit areas for genes in detail view
    detailSvg.selectAll('.gene-plus-hitbox')
      .data(plusGenes.filter(g => g.strand === '+'))
      .enter()
      .append('rect')
      .attr('class', 'gene-plus-hitbox')
      .attr('x', d => Math.max(margin.left, xDetail(d.start) - 5))
      .attr('y', 44) // Above the gene arrow
      .attr('width', d => Math.max(10, xDetail(d.end) - xDetail(d.start) + 10))
      .attr('height', 20)
      .attr('fill', 'transparent')
      .attr('cursor', 'pointer')
      .style('pointer-events', 'all')
      .on('mouseover', function (event, d) {
        throttledSetHoveredGene(d);

        // Highlight associated arrow
        detailSvg.selectAll('.gene-plus-arrow')
          .filter(g => g === d)
          .attr('stroke', '#000');
      })
      .on('mouseout', function (event, d) {
        throttledSetHoveredGene(null);

        // Remove highlight
        detailSvg.selectAll('.gene-plus-arrow')
          .attr('stroke', (d, i) => getGeneColor(geneIndexMap.current.get(d.id)));
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        setSelectedGene(d);
      });

    detailSvg.selectAll('.gene-minus-hitbox')
      .data(minusGenes.filter(g => g.strand === '-'))
      .enter()
      .append('rect')
      .attr('class', 'gene-minus-hitbox')
      .attr('x', d => Math.max(margin.left, xDetail(d.start) - 5))
      .attr('y', 74) // Increased from 62 to add more space
      .attr('width', d => Math.max(10, xDetail(d.end) - xDetail(d.start) + 10))
      .attr('height', 20)
      .attr('fill', 'transparent')
      .attr('cursor', 'pointer')
      .style('pointer-events', 'all')
      .on('mouseover', function (event, d) {
        throttledSetHoveredGene(d);

        // Highlight associated arrow
        detailSvg.selectAll('.gene-minus-arrow')
          .filter(g => g === d)
          .attr('stroke', '#000');
      })
      .on('mouseout', function (event, d) {
        throttledSetHoveredGene(null);

        // Remove highlight
        detailSvg.selectAll('.gene-minus-arrow')
          .attr('stroke', (d, i) => getGeneColor(geneIndexMap.current.get(d.id)));
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        setSelectedGene(d);
      });

    // Gene labels for each strand
    detailSvg.selectAll('.gene-label-plus')
      .data(plusGenes.filter(g => g.strand === '+'))
      .enter()
      .append('text')
      .attr('class', 'gene-label-plus')
      .attr('x', d => xDetail((d.start + d.end) / 2))
      .attr('y', 69) // Changed to position better with new spacing
      .attr('fill', '#333')
      .attr('font-size', 13)
      .attr('text-anchor', 'middle')
      .attr('alignment-baseline', 'hanging')
      .attr('clip-path', 'url(#detail-clip)')
      .text((d, i) => xDetail(d.end) - xDetail(d.start) > 20 ? d.id : '');
    detailSvg.selectAll('.gene-label-minus')
      .data(minusGenes.filter(g => g.strand === '-'))
      .enter()
      .append('text')
      .attr('class', 'gene-label-minus')
      .attr('x', d => xDetail((d.start + d.end) / 2))
      .attr('y', 99) // Changed from 85 to position better with new spacing
      .attr('fill', '#333')
      .attr('font-size', 13)
      .attr('text-anchor', 'middle')
      .attr('alignment-baseline', 'hanging')
      .attr('clip-path', 'url(#detail-clip)')
      .text((d, i) => xDetail(d.end) - xDetail(d.start) > 20 ? d.id : '');

    // --- DNA LETTERS (when zoomed in enough) ---
    const bpPerPixel = (zoomRegion[1] - zoomRegion[0]) / (availableWidth - margin.left - margin.right);
    if (bpPerPixel <= 0.2 && realSequence.length > 0) { // 1bp per 5 pixels
      // Only show letters if zoomed enough (1bp per 5 pixel or better)
      const start = Math.max(0, Math.floor(zoomRegion[0]));
      const end = Math.min(realSequence.length, Math.ceil(zoomRegion[1]));
      for (let i = start; i < end; ++i) {
        const base = realSequence[i] || '';
        detailSvg.append('text')
          .attr('x', xDetail(i + 0.5))
          .attr('y', 38)
          .attr('text-anchor', 'middle')
          .attr('font-size', 16)
          .attr('font-family', 'monospace')
          .attr('fill', baseColors[base] || '#222')
          .attr('pointer-events', 'none')
          .text(base);
      }
    }
    // --- SCALES for + strand (detail bar only, above the bar) ---
    const tickCount = 10;
    const ticks = xDetail.ticks(tickCount).filter(t => t >= zoomRegion[0] && t <= zoomRegion[1]);

    // Create a background for the scale area for brushing
    detailSvg.append('rect')
      .attr('class', 'scale-background')
      .attr('x', margin.left)
      .attr('y', 0)  // Expanded hitbox - start from the top
      .attr('width', availableWidth - margin.left - margin.right)
      .attr('height', 22)  // Taller hitbox to make selection easier
      .attr('fill', 'transparent');

    // Major ticks with labels
    detailSvg.selectAll('.scale-plus')
      .data(ticks)
      .enter()
      .append('line')
      .attr('class', 'scale-plus')
      .attr('x1', d => xDetail(d))
      .attr('x2', d => xDetail(d))
      .attr('y1', 16)
      .attr('y2', 20)
      .attr('stroke', '#555')
      .attr('stroke-width', 1.5);
    detailSvg.selectAll('.scale-plus-label')
      .data(ticks)
      .enter()
      .append('text')
      .attr('class', 'scale-plus-label')
      .attr('x', d => xDetail(d))
      .attr('y', 13)  // Moved up to accommodate larger ticks
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', '#555')
      .text(d => numberWithCommas(Math.round(d)));

    // --- BRUSH SELECTION FOR SCALE ---
    const scaleBrush = d3.brushX()
      .extent([[margin.left, 0], [availableWidth - margin.right, 22]]) // Expanded brush area
      .on('start', function (event) {
        if (!event.sourceEvent) return;
        // Prevent event propagation to avoid conflicts with chromosome drag
        if (event.sourceEvent) event.sourceEvent.stopPropagation();
      })
      .on('end', function (event) {
        // Skip if no selection or programmatic event
        if (!event.selection || !event.sourceEvent) return;

        // Prevent event propagation to avoid conflicts with chromosome drag
        if (event.sourceEvent) event.sourceEvent.stopPropagation();

        const [x0, x1] = event.selection;

        // Only process if it's a real selection (not just a click)
        if (Math.abs(x1 - x0) > 5) {
          // Convert pixels to base positions
          const newStart = xDetail.invert(x0);
          const newEnd = xDetail.invert(x1);

          // Update zoom region
          setZoomRegion([newStart, newEnd]);

          // Clear the brush
          d3.select(this).call(scaleBrush.move, null);
        }
      });

    // Add brush to the scale area
    const scaleBrushG = detailSvg.append('g')
      .attr('class', 'brush scale-brush')
      .call(scaleBrush);

    // Style the brush selection
    scaleBrushG.selectAll('.selection')
      .attr('fill', 'rgba(0, 100, 255, 0.15)')
      .attr('stroke', 'rgba(0, 100, 255, 0.8)')
      .attr('stroke-width', 1);

    // Style the brush handles
    scaleBrushG.selectAll('.handle')
      .attr('fill', 'rgba(0, 100, 255, 0.3)')
      .attr('stroke', 'rgba(0, 100, 255, 0.8)')
      .attr('stroke-width', 1);

    // Add 4 intermediate ticks between major ticks
    if (ticks.length >= 2) {
      const intermediateTicks = [];
      for (let i = 0; i < ticks.length - 1; i++) {
        const start = ticks[i];
        const end = ticks[i + 1];
        const step = (end - start) / 5;  // 5 segments = 4 intermediate ticks

        // Add 4 intermediate ticks
        for (let j = 1; j <= 4; j++) {
          intermediateTicks.push(start + step * j);
        }
      }

      detailSvg.selectAll('.scale-plus-intermediate')
        .data(intermediateTicks)
        .enter()
        .append('line')
        .attr('class', 'scale-plus-intermediate')
        .attr('x1', d => xDetail(d))
        .attr('x2', d => xDetail(d))
        .attr('y1', 17)  // Start higher for taller ticks, but less tall than major ticks
        .attr('y2', 20)  // Keep the same endpoint
        .attr('stroke', '#888')
        .attr('stroke-width', 0.8);  // Slightly thicker but still thinner than major ticks
    }

    // --- PANNING ON CHROMOSOME ---
    // Add drag behavior to chromosome bar for panning
    const dragChromosome = d3.drag()
      .on('start', function (event) {
        d3.select(this).attr('cursor', 'grabbing');
        // Store initial position to calculate delta
        d3.select(this).attr('data-start-x', event.x);
        d3.select(this).attr('data-start-zoom', JSON.stringify(zoomRegion));
      })
      .on('drag', function (event) {
        // Get the starting position and calculate shift
        const startX = parseFloat(d3.select(this).attr('data-start-x') || event.x);
        const startZoom = JSON.parse(d3.select(this).attr('data-start-zoom') || JSON.stringify(zoomRegion));

        // Total delta X from start of drag
        const deltaX = event.x - startX;

        // Calculate how far to move in chromosome coordinates
        const bpPerPixel = (startZoom[1] - startZoom[0]) / (availableWidth - margin.left - margin.right);
        const bpShift = deltaX * bpPerPixel;

        // New start and end positions, shifted from the original position
        let newStart = startZoom[0] - bpShift;
        let newEnd = startZoom[1] - bpShift;

        // Keep within chromosome bounds
        if (newStart < 0) {
          newEnd += (0 - newStart);
          newStart = 0;
        }
        if (newEnd > realChromosome.length) {
          newStart -= (newEnd - realChromosome.length);
          newEnd = realChromosome.length;
        }

        // Update the zoom region
        setZoomRegion([newStart, newEnd]);
      })
      .on('end', function () {
        d3.select(this).attr('cursor', 'grab');
        // Clean up stored data
        d3.select(this).attr('data-start-x', null);
        d3.select(this).attr('data-start-zoom', null);
      });

    // Add draggable behavior to chromosome bar with improved pointer events
    detailSvg.select('.chr-bar')
      .attr('cursor', 'grab')
      .style('pointer-events', 'all') // Ensure pointer events are enabled
      .call(dragChromosome);

    // --- Tooltip for genes in detail view ---
    detailSvg.selectAll('.gene-plus-arrow, .gene-minus-arrow')
      .on('mouseover', function (event, d) {
        throttledSetHoveredGene(d);
      })
      .on('mouseout', function () {
        throttledSetHoveredGene(null);
      });
    // Tooltip for genes in overview bar
    overviewSvg.selectAll('.gene')
      .on('mouseover', function (event, d) {
        throttledSetHoveredGene(d);
      })
      .on('mouseout', function () {
        throttledSetHoveredGene(null);
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        setSelectedGene(d);
      });

    // Remove old tooltip div if any
    d3.selectAll('.genome-tooltip').remove();

    // Add click handler to clear selected gene when clicking on background
    detailSvg.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', availableWidth)
      .attr('height', detailHeight + 40)
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')
      .lower() // Send to back so it doesn't interfere with other elements
      .on('click', function () {
        setSelectedGene(null);
      });

    overviewSvg.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', availableWidth)
      .attr('height', overviewHeight)
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')
      .lower() // Send to back so it doesn't interfere with other elements
      .on('click', function () {
        setSelectedGene(null);
      });
  }, [zoomRegion, selectedGene, hoveredGene]); // <-- Added hoveredGene

  // Draw X-shaped chromosome whenever genes or selectedGene changes
  useEffect(() => {
    if (!xChromosomeRef.current) return;

    const drawXChromosome = () => {
      const containerWidth = xChromosomeRef.current.parentElement.clientWidth - 60; // Account for padding
      const containerHeight = 320; // Fixed height for X chromosome

      // Remove previous visualization
      d3.select(xChromosomeRef.current).selectAll('*').remove();

      // Create SVG container
      const svg = d3.select(xChromosomeRef.current)
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .style('border-radius', '12px')
        .on('click', function (event) {
          if (event.target === this) setSelectedGene(null);
        });

      // --- NEW: Draw X chromosome as two mirrored curves ---
      // y = ln(x/(1-x)), y = -ln(x/(1-x)), x in (0,1)
      // We'll sample x in [0.01, 0.99] to avoid infinity at endpoints
      const N = 100;
      const xMin = 0.01, xMax = 0.99;
      const yMin = -2.2, yMax = 2.2; // Small margin for aesthetics
      const curvePoints1 = [];
      const curvePoints2 = [];
      for (let i = 0; i <= N; ++i) {
        const x = xMin + (xMax - xMin) * (i / N);
        const y = Math.log(x / (1 - x));
        curvePoints1.push({
          x: x,
          y: y
        });
        curvePoints2.push({
          x: x,
          y: -y
        });
      }
      // Scale and center
      const scaleX = d3.scaleLinear().domain([0, 1]).range([90, containerWidth - 90]); // Increased padding
      const scaleY = d3.scaleLinear().domain([yMin, yMax]).range([containerHeight - 90, 90]); // Increased padding
      // Draw the two curves
      const lineGen = d3.line()
        .x(d => scaleX(d.x))
        .y(d => scaleY(d.y))
        .curve(d3.curveBasis);
      svg.append('path')
        .attr('d', lineGen(curvePoints1))
        .attr('stroke', '#cccccc') // Match color of other chromosomes
        .attr('stroke-width', 12)
        .attr('fill', 'none');
      svg.append('path')
        .attr('d', lineGen(curvePoints2))
        .attr('stroke', '#cccccc') // Match color of other chromosomes
        .attr('stroke-width', 12)
        .attr('fill', 'none');


      // --- Place genes along the X shape ---
      if (realChromosome.genes && realChromosome.genes.length > 0) {
        realChromosome.genes.forEach((gene, index) => {
          // Map gene start/end position to [0,1] along the linear chromosome
          const posNormStart = gene.start / realChromosome.length;
          const posNormEnd = gene.end / realChromosome.length;
          
          // Clamp to avoid issues near 0/1 for the log function
          const clamp = (val) => Math.max(0.001, Math.min(0.999, val));
          const clampedNormStart = clamp(posNormStart);
          const clampedNormEnd = clamp(posNormEnd);

          // Determine the corresponding x values for START points
          const xCurve1Start = xMax - (xMax - xMin) * clampedNormStart;
          const xCurve2Start = xMin + (xMax - xMin) * clampedNormStart;
          // Determine the corresponding x values for END points
          const xCurve1End = xMax - (xMax - xMin) * clampedNormEnd;
          const xCurve2End = xMin + (xMax - xMin) * clampedNormEnd;

          // Calculate coordinates for the START points
          const yCurve1Start = Math.log(xCurve1Start / (1 - xCurve1Start));
          const svgX1Start = scaleX(xCurve1Start);
          const svgY1Start = scaleY(yCurve1Start);
          const yCurve2Start = -Math.log(xCurve2Start / (1 - xCurve2Start));
          const svgX2Start = scaleX(xCurve2Start);
          const svgY2Start = scaleY(yCurve2Start);

          // Calculate coordinates for the END points
          const yCurve1End = Math.log(xCurve1End / (1 - xCurve1End));
          const svgX1End = scaleX(xCurve1End);
          const svgY1End = scaleY(yCurve1End);
          const yCurve2End = -Math.log(xCurve2End / (1 - xCurve2End));
          const svgX2End = scaleX(xCurve2End);
          const svgY2End = scaleY(yCurve2End);
          
          // Style settings
          const isSelected = selectedGene && selectedGene.id === gene.id;
          const geneStrokeWidth = 8; // Constant thickness
          const geneStrokeColor = isSelected ? '#ff0000' : getGeneColor(geneIndexMap.current.get(gene.id)); // Red when selected
          const geneOpacity = isSelected ? 1 : 0; // Only show selected gene
          const boundaryStrokeWidth = isSelected ? geneStrokeWidth + 2 : 0;
          const boundaryOpacity = isSelected ? 1 : 0;

          // --- Draw Black Boundary Path 1 (Behind) ---
          svg.append('path')
            .attr('d', `M ${svgX1Start},${svgY1Start} L ${svgX1End},${svgY1End}`)
            .attr('stroke', '#000000') // Black boundary
            .attr('stroke-width', boundaryStrokeWidth)
            .attr('stroke-linecap', 'round')
            .attr('fill', 'none')
            .attr('opacity', boundaryOpacity);

          // --- Draw Gene Path 1 ---
          svg.append('path')
            .attr('d', `M ${svgX1Start},${svgY1Start} L ${svgX1End},${svgY1End}`)
            .attr('stroke', geneStrokeColor)
            .attr('stroke-width', geneStrokeWidth)
            .attr('stroke-linecap', 'round')
            .attr('fill', 'none')
            .attr('opacity', geneOpacity)
            .attr('cursor', 'pointer')
            .on('mouseover', function () {
              throttledSetHoveredGene(gene);
            })
            .on('mouseout', function () {
              throttledSetHoveredGene(null);
            })
            .on('click', function (event) {
              event.stopPropagation();
              setSelectedGene(gene);
            });

          // --- Draw Black Boundary Path 2 (Behind) ---
          svg.append('path')
            .attr('d', `M ${svgX2Start},${svgY2Start} L ${svgX2End},${svgY2End}`)
            .attr('stroke', '#000000') // Black boundary
            .attr('stroke-width', boundaryStrokeWidth)
            .attr('stroke-linecap', 'round')
            .attr('fill', 'none')
            .attr('opacity', boundaryOpacity);

          // --- Draw Gene Path 2 ---
          svg.append('path')
            .attr('d', `M ${svgX2Start},${svgY2Start} L ${svgX2End},${svgY2End}`)
            .attr('stroke', geneStrokeColor)
            .attr('stroke-width', geneStrokeWidth)
            .attr('stroke-linecap', 'round')
            .attr('fill', 'none')
            .attr('opacity', geneOpacity)
            .attr('cursor', 'pointer')
            .on('mouseover', function () {
              throttledSetHoveredGene(gene);
            })
            .on('mouseout', function () {
              throttledSetHoveredGene(null);
            })
            .on('click', function (event) {
              event.stopPropagation();
              setSelectedGene(gene);
            });
        });
      }
    };

    drawXChromosome();

    // Add resize listener for responsive design
    const handleResize = () => {
      drawXChromosome();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [selectedGene]);

  // --- Top Info Bar ---
  const geneCount = realChromosome.genes.length;
  const regionStart = Math.round(zoomRegion[0]);
  const regionEnd = Math.round(zoomRegion[1]);
  const regionBp = regionEnd - regionStart;
  const width = window.innerWidth;
  const margin = { left: 60, right: 60 };
  const visiblePixels = width - margin.left - margin.right;
  const minBpWindow = visiblePixels / 20;
  const minZoom = 1;
  const maxZoom = realChromosome.length / minBpWindow;
  // Use log10 scale for zoom slider
  const minZoomLog = Math.log10(minZoom);
  const maxZoomLog = Math.log10(maxZoom);
  const currentZoom = Math.round(realChromosome.length / (zoomRegion[1] - zoomRegion[0]));
  const currentZoomLog = Math.log10(currentZoom);

  // New handlers for editable position fields
  function handleStartInputChange(e) {
    setEditableStart(e.target.value);
  }

  function handleEndInputChange(e) {
    setEditableEnd(e.target.value);
  }

  function handlePositionSubmit(e) {
    e.preventDefault();

    // Parse values and handle invalid input
    let start = parseInt(editableStart.replace(/,/g, ''));
    let end = parseInt(editableEnd.replace(/,/g, ''));

    // Validate inputs
    if (isNaN(start)) start = regionStart;
    if (isNaN(end)) end = regionEnd;

    // Ensure start < end
    if (start > end) [start, end] = [end, start];

    // Enforce boundaries
    start = Math.max(0, Math.min(realChromosome.length, start));
    end = Math.max(0, Math.min(realChromosome.length, end));

    // Ensure minimum visible region (at least 10bp)
    if (end - start < 10) end = Math.min(realChromosome.length, start + 10);

    // Apply the new zoom region
    setZoomRegion([start, end]);
  }

  function handleZoomBarChange(e) {
    // Get log10 value, exponentiate to get real zoom
    const logZoom = Number(e.target.value);
    const zoom = Math.pow(10, logZoom);
    const center = (zoomRegion[0] + zoomRegion[1]) / 2;
    const regionSize = realChromosome.length / zoom;
    let newStart = Math.max(0, Math.round(center - regionSize / 2));
    let newEnd = Math.min(realChromosome.length, Math.round(center + regionSize / 2));
    // Clamp if out of bounds
    if (newStart < 0) {
      newEnd += (0 - newStart);
      newStart = 0;
    }
    if (newEnd > realChromosome.length) {
      newStart -= (newEnd - realChromosome.length);
      newEnd = realChromosome.length;
    }
    setZoomRegion([newStart, newEnd]);
  }

  function handleResetView() {
    setZoomRegion([0, realChromosome.length]);
    if (zoomRef.current) {
      d3.select(detailRef.current).transition().duration(300).call(zoomRef.current.transform, d3.zoomIdentity);
    }
  }

  useEffect(() => {
    // Only reset if genes are loaded and zoomRef is initialized
    if (genes && genes.length > 0 && zoomRef.current) {
      setZoomRegion([0, realChromosome.length]);
      d3.select(detailRef.current).transition().duration(300).call(zoomRef.current.transform, d3.zoomIdentity);
    }
    // eslint-disable-next-line
  }, [genes]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', margin: 0, padding: 0, background: '#f0f4fa', display: 'flex', flexDirection: 'column' }}>

      {/* Main info bar + Genome browser, visually carded */}
      <div style={{
        width: 'calc(100% - 48px)',
        height: '260px',
        minHeight: 260,
        margin: '24px auto 12px auto',
        background: '#fff',
        borderRadius: 18,
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Info bar - larger height */}
        <div style={{
          width: '100%',
          background: 'transparent',
          borderBottom: '1px solid #e1e6ee',
          padding: '8px 16px',
          fontSize: 15,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          letterSpacing: '0.01em',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          minHeight: 38,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18
        }}>
          <span style={{ fontSize: 14 }}>Chr: <b>{realChromosome.name}</b></span>
          <span style={{ fontSize: 14 }}>Length: <b>{numberWithCommas(realChromosome.length)} bp</b></span>
          <span style={{ fontSize: 14 }}>Genes: <b>{geneCount}</b></span>
          {/* --- GENE SEARCH BAR WITH AUTOCOMPLETE --- */}
          <div style={{ position: 'relative', width: '100%' }}>
            <form
              onSubmit={e => { e.preventDefault(); /* Placeholder for search logic */ }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', padding: '6px 12px', marginLeft: 18, minWidth: 280, maxWidth: 340 }}
              autoComplete="off"
            >
              <input
                type="text"
                placeholder="Search gene..."
                value={searchInput}
                onChange={handleSearchInputChange}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                style={{
                  fontSize: 13,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #ddd',
                  background: '#f8f8fa',
                  outline: 'none',
                  width: 380,
                  transition: 'border 0.2s',
                  marginRight: 2
                }}
                autoComplete="off"
              />
              <button
                type="submit"
                style={{
                  background: '#3b82f6',
                  border: 'none',
                  borderRadius: '50%',
                  width: 26,
                  height: 26,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: 15,
                  cursor: 'pointer',
                  opacity: 0.85
                }}
                title="Search"
              >
                <span role="img" aria-label="search">🔍</span>
              </button>
            </form>
            {/* Autocomplete dropdown */}
            {showSuggestions && (suggestions.gene_ids.length > 0 || suggestions.descriptions.length > 0) && (
              <div style={{
                position: 'absolute',
                top: 42,
                left: 0,
                width: '100%',
                background: '#fff',
                border: '1px solid #e1e6ee',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.09)',
                zIndex: 100,
                maxHeight: 260,
                overflowY: 'auto',
                padding: '6px 0',
              }}>
                {/* Gene ID Suggestions */}
                {suggestions.gene_ids.length > 0 && (
                  <div style={{ padding: '2px 12px 2px 12px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#555', marginBottom: 2 }}>Gene IDs</div>
                    {suggestions.gene_ids.map((id, idx) => (
                      <div
                        key={id}
                        style={{
                          padding: '6px 0',
                          cursor: 'pointer',
                          borderBottom: idx === suggestions.gene_ids.length - 1 && suggestions.descriptions.length === 0 ? 'none' : '1px solid #f3f3f3',
                          color: '#2d4b7c',
                        }}
                        onMouseDown={() => handleSuggestionSelect({ type: 'gene_id', value: id })}
                      >
                        {id}
                      </div>
                    ))}
                  </div>
                )}
                {/* Description Keyword Suggestions */}
                {suggestions.descriptions.length > 0 && (
                  <div style={{ padding: '2px 12px 2px 12px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#555', margin: '8px 0 2px 0' }}>Description Keywords</div>
                    {suggestions.descriptions.map((desc, idx) => (
                      <div
                        key={desc.keyword}
                        style={{
                          padding: '6px 0',
                          cursor: 'pointer',
                          borderBottom: idx === suggestions.descriptions.length - 1 ? 'none' : '1px solid #f3f3f3',
                          color: '#5c2d7c',
                        }}
                        onMouseDown={() => handleSuggestionSelect({ type: 'desc_keyword', value: desc.keyword, genes: desc.genes })}
                      >
                        {desc.keyword} <span style={{ color: '#aaa', fontSize: 12 }}>({desc.genes.length} genes)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* --- ZOOM BAR TOOL --- */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
            <label htmlFor="zoom-bar" style={{ fontSize: 13 }}>Zoom:</label>
            <input
              id="zoom-bar"
              type="range"
              min={minZoomLog}
              max={maxZoomLog}
              step={0.01}
              value={currentZoomLog}
              onChange={handleZoomBarChange}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 13 }}>{currentZoom}x</span>
          </span>
          {/* --- RESET VIEW BUTTON --- */}
          <button
            onClick={handleResetView}
            style={{
              marginLeft: 0,
              fontSize: 13,
              padding: '3px 8px',
              border: '1px solid #bbb',
              borderRadius: 6,
              background: '#f8f8fa',
              cursor: 'pointer',
              transition: 'background 0.2s',
              fontWeight: 600
            }}
          >Reset View</button>
          {/* --- EDITABLE VIEW RANGE INPUTS --- */}
          <form
            onSubmit={handlePositionSubmit}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              marginLeft: 0,
              fontSize: 13,
              color: '#444'
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 'normal' }}>View:</span>
            <input
              type="text"
              value={editableStart}
              onChange={handleStartInputChange}
              style={{
                width: '70px',
                fontSize: '13px',
                padding: '2px 4px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                textAlign: 'right'
              }}
              title="Start position (bp)"
            />
            <span>-</span>
            <input
              type="text"
              value={editableEnd}
              onChange={handleEndInputChange}
              style={{
                width: '70px',
                fontSize: '13px',
                padding: '2px 4px',
                border: '1px solid #ddd',
                borderRadius: '4px'
              }}
              title="End position (bp)"
            />
            <span>bp ({numberWithCommas(regionBp)} bp)</span>
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#3b82f6',
                cursor: 'pointer',
                fontSize: '13px',
                marginLeft: '3px',
                padding: '1px 4px',
                borderRadius: '4px',
                fontWeight: 'bold'
              }}
              title="Go to position"
            >
              Go
            </button>
          </form>
        </div>
        {/* Genome SVGs */}
        <div style={{ width: '100%', height: '60%', background: '#fff', borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }}>
          <svg ref={overviewRef} style={{ display: 'block', width: '100%', height: 80 }} />
          <svg ref={detailRef} style={{ display: 'block', width: '100%', height: 100 }} />
        </div>
      </div>
      {/* Bottom section: Left Panel + Tooltip + Chatbot visually carded */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%', background: 'transparent', position: 'relative', gap: 24, padding: '0 24px 24px 24px', boxSizing: 'border-box' }}>
        {/* New Left Panel with X Chromosome */}
        <div style={{ width: '33.3%', minWidth: 250, height: '100%', background: '#fff', borderRadius: 18, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', boxSizing: 'border-box', padding: '28px 30px', fontSize: 16, color: '#222', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 500, marginBottom: 12 }}>X-Shaped Chromosome Visualization</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <svg ref={xChromosomeRef} style={{ maxWidth: '100%', height: 'auto' }}></svg>
          </div>
          <div style={{ fontSize: 14, color: '#888', marginTop: 16, textAlign: 'center' }}>
            Genes are mapped from linear position to X-shape. Click a gene to select it.
          </div>
        </div>
        {/* Tooltip area (center) */}
        <div style={{ width: '33.3%', minWidth: 250, height: '100%', background: '#fff', borderRadius: 18, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', boxSizing: 'border-box', padding: '28px 30px', fontSize: 16, color: '#222', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Tooltip for when we select an element (currently, only genes)</div>
          {(selectedGene || hoveredGene) ? (
            <div style={{ fontSize: 18, marginTop: 16, lineHeight: 1.7 }}>
              <div><b>ID:</b> {(selectedGene || hoveredGene).id.replace(/^gene-/, '')}</div>
              <div><b>Start:</b> {numberWithCommas((selectedGene || hoveredGene).start)}</div>
              <div><b>End:</b> {numberWithCommas((selectedGene || hoveredGene).end)}</div>
              <div><b>Strand:</b> {(selectedGene || hoveredGene).strand}</div>
              <div><b>GenBank key:</b> {(selectedGene || hoveredGene).attributes['gbkey']}</div>
              <div><b>Gene Biotype:</b> {(selectedGene || hoveredGene).attributes['gene_biotype']}</div>
              {selectedGene && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                  (Gene is selected. Click elsewhere to deselect.)
                </div>
              )}
              {/* Most Probable Annotation Info */}
              <MostProbableAnnotationDisplay
                gene={selectedGene || hoveredGene}
                chromosome={realChromosome}
              />
            </div>
          ) : (
            <div style={{ color: '#888', marginTop: 16 }}>Hover over or click a gene to see its details here.</div>
          )}
        </div>
        {/* Chatbot area (right) */}
        <div style={{ width: '33.3%', minWidth: 250, height: '100%', background: '#fff', borderRadius: 18, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', boxSizing: 'border-box', padding: '28px 30px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 22, letterSpacing: 0.5 }}>ChatBot</div>
          <ChatbotWidget />
        </div>
      </div>
    </div>
  );
}

export default GenomeBrowser;
