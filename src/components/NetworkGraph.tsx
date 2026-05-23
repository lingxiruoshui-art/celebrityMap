import { useEffect, useRef, useState, useMemo } from "react";
import { motion, useDragControls } from "motion/react";
import * as d3 from "d3";
import { Person, Relationship } from "../types";
import { User, Quote, X, MessageCircle, Loader2 } from "lucide-react";

interface GraphProps {
  people: Person[];
  relationships: Relationship[];
  selectedPersonId: number | null;
  onSelectPerson: (id: number) => void;
  discoveryPath?: { name: string }[] | null;
}

export default function NetworkGraph({ 
  people, 
  relationships, 
  selectedPersonId, 
  onSelectPerson, 
  discoveryPath 
}: GraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesSelectionRef = useRef<any>(null);
  const onSelectRef = useRef(onSelectPerson);
  const scaleRef = useRef(1);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [selectedRelationship, setSelectedRelationship] = useState<{
    rel: Relationship;
    source: Person;
    target: Person;
    x: number;
    y: number;
  } | null>(null);

  const [chatState, setChatState] = useState<{
    isLoading: boolean;
    messages: { speaker: string, text: string }[];
    error?: string;
  } | null>(null);

  const controls = useDragControls();
  
  // Slicing and filtering logic for performance with large datasets (10,000+ people)
  // We only render a manageable "active subset" of the graph
  const filteredNodes = useMemo(() => {
    if (people.length <= 200) return people;
    
    const maxNodes = 200;
    const activeId = selectedPersonId;
    // 0. Add people in the discovery path first (to guarantee the green path renders fully)
    const normalizedPathNames = (discoveryPath || []).map(p => p.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, ""));
    const seenIds = new Set<number>();
    const result: Person[] = [];

    if (discoveryPath && discoveryPath.length > 0) {
      discoveryPath.forEach(pathItem => {
        const normItem = pathItem.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "");
        const p = people.find(persona => {
          const normPersona = persona.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "");
          return normPersona === normItem;
        });
        if (p && !seenIds.has(p.id)) {
          result.push(p);
          seenIds.add(p.id);
        }
      });
    }

    // 1. Add selected person
    if (activeId) {
      const p = people.find(persona => persona.id === activeId);
      if (p && !seenIds.has(p.id)) {
        result.push(p);
        seenIds.add(p.id);
      }
    }

    // 2. Add direct neighbors of selected person
    if (activeId) {
      const neighbors = relationships
        .filter(r => r.person1_id === activeId || r.person2_id === activeId)
        .map(r => r.person1_id === activeId ? r.person2_id : r.person1_id);
      
      for (const nid of neighbors) {
        if (result.length >= maxNodes) break;
        if (!seenIds.has(nid)) {
          const p = people.find(persona => persona.id === nid);
          if (p) {
            result.push(p);
            seenIds.add(p.id);
          }
        }
      }
    }

    // 3. Add newest arrivals (up to 20)
    const sortedByNewest = [...people].sort((a, b) => 
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
    for (const p of sortedByNewest.slice(0, 20)) {
      if (result.length >= maxNodes) break;
      if (!seenIds.has(p.id)) {
        result.push(p);
        seenIds.add(p.id);
      }
    }

    // 4. Fill remaining with random people to keep the globe populated
    const remainingCount = maxNodes - result.length;
    if (remainingCount > 0) {
      // Simple "random" by taking people at even intervals if we have a lot
      const step = Math.max(1, Math.floor(people.length / remainingCount));
      for (let i = 0; i < people.length && result.length < maxNodes; i += step) {
        const p = people[i];
        if (!seenIds.has(p.id)) {
          result.push(p);
          seenIds.add(p.id);
        }
      }
    }

    return result;
  }, [people, relationships, selectedPersonId]);

  const filteredRelationships = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(p => p.id));
    const seen = new Set<string>();
    return relationships.filter(r => {
      if (!nodeIds.has(r.person1_id) || !nodeIds.has(r.person2_id)) return false;
      const min = Math.min(r.person1_id, r.person2_id);
      const max = Math.max(r.person1_id, r.person2_id);
      const key = `${min}_${max}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredNodes, relationships]);

  useEffect(() => {
    setChatState(null);
  }, [selectedRelationship]);

  useEffect(() => {
    onSelectRef.current = onSelectPerson;
  }, [onSelectPerson]);

  const handleStartChat = async () => {
    if (!selectedRelationship) return;
    setChatState({ isLoading: true, messages: [] });
    
    try {
      const res = await fetch("/api/archiver/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person1: selectedRelationship.source.name,
          person2: selectedRelationship.target.name
        })
      });
      const data = await res.json() as any;
      
      if (!res.ok) {
        let errorMsg = data.error || "请求失败";
        if (data.details) {
            try {
                const parsed = JSON.parse(data.details);
                if (parsed.error && parsed.error.message) {
                    errorMsg += ": " + parsed.error.message;
                } else {
                    errorMsg += ": " + data.details;
                }
            } catch (e) {
                errorMsg += ": " + data.details;
            }
        }
        setChatState({ isLoading: false, messages: [], error: errorMsg });
        return;
      }

      if (data.messages && data.messages.length > 0) {
        setChatState({
          isLoading: false,
          messages: data.messages
        });
      } else {
        setChatState({ isLoading: false, messages: [], error: "未生成有效对话" });
      }
    } catch(e: any) {
      console.error(e);
      setChatState({ isLoading: false, messages: [], error: e.message || "网络请求异常" });
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    // Close relationship modal when selection changes
    setSelectedRelationship(null);
  }, [people, relationships, selectedPersonId]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || dimensions.width === 0) return;

    const width = dimensions.width;
    const height = dimensions.height || 500;

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    // If people.length === 0, we still proceed to render the globe sphere background & graticules for a beautiful empty state!

    // Base Scale & Projection
    const baseScale = Math.min(width, height) / 2.2;
    const projection = d3.geoOrthographic()
      .scale(baseScale)
      .translate([width / 2, height / 2])
      .clipAngle(90) // Hide the back
      .rotate([0, 0]);

    const path = d3.geoPath().projection(projection) as any;

    const graticule = d3.geoGraticule10();

    // Definitions for styling
    const defs = svg.append("defs");
    
    const sphereGradient = defs.append("radialGradient")
      .attr("id", "sphere-default")
      .attr("cx", "30%")
      .attr("cy", "30%")
      .attr("r", "70%");
    sphereGradient.append("stop").attr("offset", "0%").attr("stop-color", "#e0e7ff");
    sphereGradient.append("stop").attr("offset", "50%").attr("stop-color", "#a5b4fc");
    sphereGradient.append("stop").attr("offset", "100%").attr("stop-color", "#6366f1");

    const sphereSelectedGradient = defs.append("radialGradient")
      .attr("id", "sphere-selected")
      .attr("cx", "30%")
      .attr("cy", "30%")
      .attr("r", "70%");
    sphereSelectedGradient.append("stop").attr("offset", "0%").attr("stop-color", "#f472b6");
    sphereSelectedGradient.append("stop").attr("offset", "70%").attr("stop-color", "#ec4899");
    sphereSelectedGradient.append("stop").attr("offset", "100%").attr("stop-color", "#be185d");

    const spherePathGradient = defs.append("radialGradient")
      .attr("id", "sphere-path")
      .attr("cx", "30%")
      .attr("cy", "30%")
      .attr("r", "70%");
    spherePathGradient.append("stop").attr("offset", "0%").attr("stop-color", "#a7f3d0");
    spherePathGradient.append("stop").attr("offset", "60%").attr("stop-color", "#10b981");
    spherePathGradient.append("stop").attr("offset", "100%").attr("stop-color", "#047857");

    const sphereNewestGradient = defs.append("radialGradient")
      .attr("id", "sphere-newest")
      .attr("cx", "30%")
      .attr("cy", "30%")
      .attr("r", "70%");
    sphereNewestGradient.append("stop").attr("offset", "0%").attr("stop-color", "#fde68a");
    sphereNewestGradient.append("stop").attr("offset", "100%").attr("stop-color", "#f59e0b");

    const sphereBackground = defs.append("radialGradient")
      .attr("id", "sphere-bg")
      .attr("cx", "50%")
      .attr("cy", "50%")
      .attr("r", "50%");
    sphereBackground.append("stop").attr("offset", "0%").attr("stop-color", "#ffffff").attr("stop-opacity", 1.0);
    sphereBackground.append("stop").attr("offset", "70%").attr("stop-color", "#f1f5f9").attr("stop-opacity", 0.85);
    sphereBackground.append("stop").attr("offset", "85%").attr("stop-color", "#e0e7ff").attr("stop-opacity", 0.65);
    sphereBackground.append("stop").attr("offset", "100%").attr("stop-color", "#c7d2fe").attr("stop-opacity", 0.45);

    // Glow filter for beautiful visuals
    const glowFilter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-20%")
      .attr("y", "-20%")
      .attr("width", "140%")
      .attr("height", "140%");
    glowFilter.append("feGaussianBlur")
      .attr("stdDeviation", "2.5")
      .attr("result", "blur");
    glowFilter.append("feComposite")
      .attr("in", "SourceGraphic")
      .attr("in2", "blur")
      .attr("operator", "over");

    // Layers
    const mapLayer = svg.append("g").attr("class", "map-layer");
    const linksLayer = svg.append("g").attr("class", "links-layer");
    const arrowsLayer = svg.append("g").attr("class", "arrows-layer");
    const linksHitLayer = svg.append("g").attr("class", "links-hit-layer");
    const nodesLayer = svg.append("g").attr("class", "nodes-layer");

    // Transparent Sphere Base
    mapLayer.append("path")
      .datum({type: "Sphere"})
      .attr("class", "globe-sphere")
      .attr("fill", "url(#sphere-bg)")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2 4");

    // Optional: Subtle grid lines to define the sphere shape
    mapLayer.append("path")
      .datum(graticule)
      .attr("class", "globe-graticule")
      .attr("fill", "none")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 0.5);

    // Distribute people evenly using a Fibonacci Sphere algorithm
    // Sorting by ID ensures stable indexing so existing nodes only shift slightly when new ones are added
    const sortedPeople = [...filteredNodes].sort((a, b) => a.id - b.id);
    const maxCreatedAt = sortedPeople.length > 0 
      ? Math.max(...sortedPeople.map(p => p.created_at ? new Date(p.created_at).getTime() : 0)) 
      : 0;

    const N = sortedPeople.length;
    const phi = (1 + Math.sqrt(5)) / 2; // Golden ratio
    const angleIncrement = Math.PI * 2 * phi;

    const processedPeople = sortedPeople.map((p, i) => {
      // Consider "newest" as anyone added within 10 seconds of the absolute latest entry
      // This handles batch additions gracefully
      const isNewest = p.created_at && (maxCreatedAt - new Date(p.created_at).getTime() < 10000);
      
      // y goes from 1 to -1 (top to bottom of sphere)
      const y = N > 1 ? 1 - (i / (N - 1)) * 2 : 0;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = angleIncrement * i;

      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;

      // Convert 3D Cartesian coordinates to Latitude/Longitude for the D3 projection
      const lat = Math.asin(y) * (180 / Math.PI);
      const lng = Math.atan2(z, x) * (180 / Math.PI);

      return {
        ...p, 
        isNewest,
        displayLat: lat, 
        displayLng: lng 
      };
    });

    // Create Links
    const baseLinks = filteredRelationships.map(r => {
      const sourcePerson = processedPeople.find(p => p.id === r.person1_id);
      const targetPerson = processedPeople.find(p => p.id === r.person2_id);
      
      let inPath = false;
      let pathDirection = 1;
      if (discoveryPath && sourcePerson && targetPerson) {
        const normSource = sourcePerson.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "");
        const normTarget = targetPerson.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "");
        const sIdx = discoveryPath.findIndex((p: any) => p.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "") === normSource);
        const tIdx = discoveryPath.findIndex((p: any) => p.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "") === normTarget);
        if (sIdx !== -1 && tIdx !== -1 && Math.abs(sIdx - tIdx) === 1) {
          inPath = true;
          pathDirection = sIdx < tIdx ? 1 : -1;
        }
      }

      const isNewestLink = sourcePerson?.isNewest || targetPerson?.isNewest;
      const id = `link-${sourcePerson?.id}-${targetPerson?.id}`;

      return { id, sourcePerson, targetPerson, inPath, pathDirection, isNewestLink, relationship: r };
    }).filter(l => l.sourcePerson && l.targetPerson) as any[];

    // Ensure EVERY step in the discoveryPath is connected by a link
    if (discoveryPath && discoveryPath.length > 1) {
      for (let i = 0; i < discoveryPath.length - 1; i++) {
        const nameA = discoveryPath[i].name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "");
        const nameB = discoveryPath[i + 1].name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "");
        
        const nodeA = processedPeople.find(p => p.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "") === nameA);
        const nodeB = processedPeople.find(p => p.name.trim().toLowerCase().replace(/·|•|・|●/g, "·").replace(/\s+/g, "") === nameB);
        
        if (nodeA && nodeB) {
          const hasExisting = baseLinks.some(l => 
            ((l.sourcePerson.id === nodeA.id && l.targetPerson.id === nodeB.id) ||
             (l.sourcePerson.id === nodeB.id && l.targetPerson.id === nodeA.id)) && l.inPath
          );
          
          if (!hasExisting) {
            baseLinks.push({
              id: `link-virtual-${nodeA.id}-${nodeB.id}`,
              sourcePerson: nodeA,
              targetPerson: nodeB,
              inPath: true,
              pathDirection: 1,
              isNewestLink: false,
              relationship: {
                id: -999 - i,
                person1_id: nodeA.id,
                person2_id: nodeB.id,
                relationship_type: "时空折叠连接",
                description: "时空寻路建立的连接线"
              }
            });
          }
        }
      }
    }

    const links = baseLinks;

    const linkElements = linksLayer.selectAll("path")
      .data(links)
      .join("path")
      .attr("id", (d: any) => d.id)
      .attr("class", (d: any) => `relationship-path ${d.isNewestLink ? 'is-new-arrival' : ''}`)
      .attr("fill", "none")
      .attr("stroke", (d: any) => {
        if (d.inPath) return "#ef4444";
        return "#94a3b8";
      })
      .attr("stroke-opacity", (d: any) => d.inPath ? 1 : 0.55)
      .attr("stroke-width", (d: any) => {
        if (d.inPath) return 1.75;
        return 0.6;
      })
      .style("pointer-events", "none");

    const movingArrows = arrowsLayer.selectAll("g.moving-arrow")
      .data(links.filter(l => l.inPath), (d: any) => d.id)
      .join(
        enter => {
          const g = enter.append("g").attr("class", "moving-arrow");
          g.append("polygon")
            .attr("points", "-4,-4 4,0 -4,4")
            .attr("fill", "#10b981");
          
          g.append("animateMotion")
            .attr("dur", "2s")
            .attr("repeatCount", "indefinite")
            .attr("rotate", "auto")
            .append("mpath")
              .attr("href", (d: any) => `#${d.id}`);
          return g;
        },
        update => update,
        exit => exit.remove()
      );

    const hitElements = linksHitLayer.selectAll("path")
      .data(links)
      .join("path")
      .attr("class", "link-hit-area")
      .attr("fill", "none")
      .attr("stroke", "transparent")
      .attr("stroke-width", 15)
      .on("mouseenter", function(event, d: any) {
        linkElements.filter(l => l === d).classed("is-hovered", true);
      })
      .on("mouseleave", function(event, d: any) {
        linkElements.filter(l => l === d).classed("is-hovered", false);
      })
      .on("click", function(event, d: any) {
        event.stopPropagation();
        const coords = d3.pointer(event, containerRef.current);
        setSelectedRelationship({
          rel: d.relationship,
          source: d.sourcePerson,
          target: d.targetPerson,
          x: coords[0],
          y: coords[1]
        });
      });

    let isHoveringNode = false;

    const nodeElements = nodesLayer.selectAll("g")
      .data(processedPeople)
      .join("g")
      .attr("class", "node-group")
      .style("cursor", "pointer")
      .on("click", (event, d: any) => onSelectRef.current?.(d.id))
      .on("mouseenter", function(event, d: any) {
        isHoveringNode = true;
        d3.select(this).select(".node-circle").transition().duration(200).attr("r", 10);
        d3.select(this).selectAll("text").transition().duration(200).style("opacity", 1);
        
        // Highlight connected links
        const hasPath = discoveryPath && discoveryPath.length > 1;
        linkElements
          .attr("stroke", (l: any) => (hasPath && l.inPath) ? "#10b981" : ((l.sourcePerson.id === d.id || l.targetPerson.id === d.id) ? "#8b5cf6" : "#475569"))
          .attr("stroke-opacity", (l: any) => {
            if (l.sourcePerson.id === d.id || l.targetPerson.id === d.id) return 1;
            if (hasPath && l.inPath) return 1;
            if (scaleRef.current > 1.5 || filteredNodes.length <= 25) return 0.65;
            return 0.25;
          })
          .attr("stroke-width", (l: any) => {
            if (l.sourcePerson.id === d.id || l.targetPerson.id === d.id) return 2.5;
            if (hasPath && l.inPath) return 2.8;
            if (scaleRef.current > 1.5 || filteredNodes.length <= 25) return 1.1;
            return 0.8;
          });
      })
      .on("mouseleave", function(event, d: any) {
        isHoveringNode = false;
        updateStyles();
      });

    nodeElements.append("circle")
      .attr("r", 6)
      .attr("class", "node-circle");

    nodeElements.append("text")
      .attr("dx", 10)
      .attr("dy", 4)
      .attr("class", "node-label-bg")
      .style("font-family", "system-ui, sans-serif")
      .style("font-size", "12px")
      .style("font-weight", "800")
      .style("stroke", "rgba(255,255,255,0.95)")
      .style("stroke-width", 4)
      .style("stroke-linejoin", "round")
      .style("fill", "none")
      .text((d: any) => d.name);

    nodeElements.append("text")
      .attr("dx", 10)
      .attr("dy", 4)
      .attr("class", "node-label")
      .style("font-family", "system-ui, sans-serif")
      .style("font-size", "12px")
      .style("font-weight", "800")
      .style("fill", "#0f172a")
      .text((d: any) => d.name);

    nodesSelectionRef.current = nodeElements;

    // Checks if the given geographic coordinate is facing the viewer
    const isVisible = (lng: number, lat: number) => {
      const p = path({type: "Point", coordinates: [lng, lat]});
      return p !== null && p !== undefined;
    };

    const updateGlobe = () => {
      mapLayer.selectAll(".globe-sphere").attr("d", path as any);
      mapLayer.selectAll(".globe-graticule").attr("d", path(graticule) as any);

      const pathGen = (d: any) => {
        let coords = [
          [d.sourcePerson.displayLng, d.sourcePerson.displayLat], 
          [d.targetPerson.displayLng, d.targetPerson.displayLat]
        ];
        if (d.inPath && d.pathDirection === -1) {
          coords = coords.reverse();
        }
        return path({
          type: "LineString",
          coordinates: coords
        }) as any;
      };

      linkElements.attr("d", pathGen);
      hitElements.attr("d", pathGen);

      nodeElements.attr("transform", (d: any) => {
        const pos = projection([d.displayLng, d.displayLat]);
        return pos ? `translate(${pos[0]},${pos[1]})` : "translate(-1000,-1000)";
      });

      // Show/Hide depending on which side of the globe they are
      nodeElements
        .style("display", (d: any) => isVisible(d.displayLng, d.displayLat) ? "block" : "none")
        .style("pointer-events", (d: any) => isVisible(d.displayLng, d.displayLat) ? "all" : "none");

      if (!isHoveringNode) {
        updateStyles();
      }
    };

    const updateStyles = () => {
      const activeId = selectedPersonId;
      const hasPath = discoveryPath && discoveryPath.length > 1;
      
      linkElements
        .classed("is-bridge", (d: any) => !!hasPath && d.inPath)
        .classed("is-selected-rel", (d: any) => !!activeId && (d.sourcePerson.id === activeId || d.targetPerson.id === activeId))
        .attr("stroke", (d: any) => {
          if (hasPath && d.inPath) return "#10b981"; // Discovery path: Emerald Green (Solid/Stable)
          if (activeId && (d.sourcePerson.id === activeId || d.targetPerson.id === activeId)) return "#8b5cf6"; // Focal Person: Vibrant Purple
          return "#475569"; // Unified base grey: Darker Slate for visibility
        })
        .attr("stroke-opacity", (d: any) => {
           if (activeId && (d.sourcePerson.id === activeId || d.targetPerson.id === activeId)) return 1;
           if (hasPath && d.inPath) return 1;
           if (scaleRef.current > 1.5 || filteredNodes.length <= 25) return 0.65;
           return (activeId || hasPath ? 0.2 : 0.6);
        })
        .attr("stroke-width", (d: any) => {
          if (activeId && (d.sourcePerson.id === activeId || d.targetPerson.id === activeId)) return 2.0;
          if (hasPath && d.inPath) return 2.8;
          if (scaleRef.current > 1.5 || filteredNodes.length <= 25) return 1.1;
          return 0.8;
        });

      if (!nodesSelectionRef.current) return;
      
      nodesSelectionRef.current.selectAll(".node-circle")
        .attr("fill", (d: any) => {
          const inP = hasPath && discoveryPath && discoveryPath.some(p => p.name === d.name);
          if (inP) return "url(#sphere-path)";
          if (d.id === activeId) return "url(#sphere-selected)";
          return "url(#sphere-default)";
        })
        .attr("r", (d: any) => {
          const inP = hasPath && discoveryPath && discoveryPath.some(p => p.name === d.name);
          if (inP) return 8;
          if (d.id === activeId) return 8;
          const isNeighbor = !hasPath && activeId && links.some(l => 
            (l.sourcePerson.id === activeId && l.targetPerson.id === d.id) || 
            (l.targetPerson.id === activeId && l.sourcePerson.id === d.id)
          );
          if (isNeighbor) return 7;
          return 6;
        })
        .attr("stroke", (d: any) => {
          const inP = hasPath && discoveryPath && discoveryPath.some(p => p.name === d.name);
          if (inP) return "#047857";
          if (d.id === activeId) return "#7c3aed";
          const isNeighbor = !hasPath && activeId && links.some(l => 
            (l.sourcePerson.id === activeId && l.targetPerson.id === d.id) || 
            (l.targetPerson.id === activeId && l.sourcePerson.id === d.id)
          );
          if (isNeighbor) return "#a78bfa";
          return "#94a3b8";
        })
        .attr("stroke-width", (d: any) => {
          const inP = hasPath && discoveryPath && discoveryPath.some(p => p.name === d.name);
          if (inP || d.id === activeId) return 3.5;
          return 1.5;
        })
        .style("filter", (d: any) => {
          const inP = hasPath && discoveryPath && discoveryPath.some(p => p.name === d.name);
          if (inP || d.id === activeId) return "url(#glow)";
          return "none";
        })
        .attr("fill-opacity", (d: any) => {
          const inP = hasPath && discoveryPath && discoveryPath.some(p => p.name === d.name);
          if (inP || d.id === activeId) return 1;
          const isNeighbor = !hasPath && activeId && links.some(l => 
            (l.sourcePerson.id === activeId && l.targetPerson.id === d.id) || 
            (l.targetPerson.id === activeId && l.sourcePerson.id === d.id)
          );
          if (isNeighbor) return 0.9;
          if (scaleRef.current > 1.5 || filteredNodes.length <= 25) return 0.9;
          return (activeId || hasPath ? 0.15 : 1);
        });

      nodesSelectionRef.current.selectAll("text.node-label, text.node-label-bg")
        .style("opacity", function(this: any, d: any) {
           if (d.id === activeId || d.isNewest) return 1;
           if (discoveryPath && discoveryPath.some(p => p.name === d.name)) return 1;
           return (scaleRef.current > 1.5 || filteredNodes.length <= 25) ? 1 : 0;
        })
        .style("font-size", (d: any) => {
           if (d.id === activeId) return "16px";
           if (discoveryPath && discoveryPath.some(p => p.name === d.name)) return "14px";
           if (d.isNewest) return "13px";
           return "12px";
        });
    };

    // Zoom setup - only allow wheel or pinch to zoom
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 8])
      .filter((event) => {
        // Prevent pan-zoom from interfering with our custom drag rotation
        if (event.type === 'wheel') return true;
        if (event.type === 'touchstart' && event.touches && event.touches.length > 1) return true;
        return false;
      })
      .on("zoom", (event) => {
        scaleRef.current = event.transform.k;
        projection.scale(baseScale * event.transform.k);
        updateGlobe();
      });
      
    svg.call(zoomBehavior as any);

    // Initial positioning via drag
    let isDragging = false;
    let autoRotateEnabled = !selectedPersonId; // Disable auto rotation initially if someone is selected
    let oldP: [number, number] | null = null;

    // Focus rotation logic
    const focusOnPerson = (personId: number) => {
      const targetPerson = processedPeople.find(p => p.id === personId);
      if (!targetPerson) return;
      
      autoRotateEnabled = false;
      
      const r = projection.rotate();
      const targetRotate: [number, number, number] = [-targetPerson.displayLng, -targetPerson.displayLat, r[2] || 0];
      
      // Smoothly interpolate rotation
      d3.transition()
        .duration(1000)
        .ease(d3.easeCubicInOut)
        .tween("rotate", () => {
          const i = d3.interpolate(projection.rotate(), targetRotate);
          return (t) => {
            projection.rotate(i(t) as [number, number, number]);
            updateGlobe();
          };
        });
    };

    // Trigger focus if selection changes
    if (selectedPersonId) {
      focusOnPerson(selectedPersonId);
    }
    
    const dragBehavior = d3.drag<SVGSVGElement, unknown>()
      .on("start", (event) => {
        isDragging = true;
        autoRotateEnabled = false; // Disable auto rotation after user interacts
        oldP = [event.x, event.y];
      })
      .on("drag", (event) => {
        if (!oldP) return;
        const dx = event.x - oldP[0];
        const dy = event.y - oldP[1];
        oldP = [event.x, event.y];

        const r = projection.rotate();
        // The rotation speed relative to scale
        const k = 120 / projection.scale();
        
        let newLat = r[1] - dy * k;
        // Keep vertical angle between -90 and 90 to prevent flipping
        if (newLat > 90) newLat = 90;
        if (newLat < -90) newLat = -90;

        projection.rotate([r[0] + dx * k, newLat, r[2]]);
        updateGlobe();
      })
      .on("end", () => {
        isDragging = false;
        oldP = null;
      });

    svg.call(dragBehavior as any);

    svg.on("click", () => {
      setSelectedRelationship(null);
    });

    svg.on("mouseenter", () => {
      autoRotateEnabled = false;
    });

    svg.on("mouseleave", () => {
      // Don't auto-rotate if we are in the middle of a drag or something else
      if (!isDragging) {
        autoRotateEnabled = true;
      }
    });

    // Initial auto rotation
    const rotationTimer = d3.timer((elapsed) => {
      // Auto rotate very slowly if not dragging
      if (!isDragging && autoRotateEnabled) {
        const currentRotate = projection.rotate();
        // Dynamic multiaxial drift (horizontal slow spin + gentle organic vertical wiggle)
        const nextLng = currentRotate[0] + 0.12;
        const nextLat = 8 * Math.sin(elapsed / 6000);
        projection.rotate([nextLng, nextLat]);
        updateGlobe();
      }
    });

    updateGlobe();
    return () => {
      rotationTimer.stop();
    };
  }, [filteredNodes, filteredRelationships, discoveryPath, selectedPersonId, dimensions]);

  const dialogWidth = Math.min(320, dimensions.width - 32);
  const initialLeft = selectedRelationship ? Math.max(16, Math.min(dimensions.width - dialogWidth - 16, selectedRelationship.x - dialogWidth / 2)) : 0;
  const initialTop = selectedRelationship ? Math.max(16, Math.min(dimensions.height - 200, selectedRelationship.y < 350 ? selectedRelationship.y + 20 : selectedRelationship.y - Math.min(300, dimensions.height / 2))) : 0;

  return (
    <div ref={containerRef} className="w-full h-full cursor-default relative overflow-visible">
      <style>{`
        @keyframes colorful-glow {
          0% { stroke: #818cf8; }
          25% { stroke: #ec4899; }
          50% { stroke: #eab308; }
          75% { stroke: #22c55e; }
          100% { stroke: #818cf8; }
        }
        @keyframes dash-flow {
          to { stroke-dashoffset: -20; }
        }
        .link-hit-area {
          pointer-events: stroke;
          cursor: pointer;
        }
        .relationship-path {
          transition: stroke 0.3s, stroke-width 0.3s, stroke-opacity 0.3s;
        }
        .relationship-path.is-hovered {
          stroke: #94a3b8 !important;
          stroke-opacity: 1 !important;
          stroke-width: 1.5 !important;
          stroke-dasharray: 4 2 !important;
          animation: dash-flow 0.4s linear infinite !important;
          cursor: pointer;
          z-index: 50;
        }
        .relationship-path.is-bridge {
          /* Solid vibrant line for discovery path */
          stroke-dasharray: none;
          animation: none;
        }
        .relationship-path.is-selected-rel {
          /* Solid vibrant line for selected person connections */
          stroke-dasharray: none;
          animation: none;
        }
        @keyframes newest-pulse {
          0% { stroke-opacity: 0.4; }
          50% { stroke-opacity: 1; }
          100% { stroke-opacity: 0.4; }
        }
        .relationship-path.is-new-arrival {
          /* Pulse only opacity, keep width/color consistent with base status */
          animation: newest-pulse 2s ease-in-out infinite;
        }

        .nice-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .nice-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .nice-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
      `}</style>
      <svg ref={svgRef} />
      
      {selectedRelationship && (
        <motion.div 
          className="absolute z-[100]"
          drag
          dragListener={false}
          dragControls={controls}
          dragMomentum={false}
          dragConstraints={{
            left: -initialLeft + 16,
            right: dimensions.width - initialLeft - dialogWidth - 16,
            top: -initialTop,     // Stops exactly at the top boundary
            // bottom is unbound to allow scrolling page when long
          }}
          style={{ 
            left: initialLeft,
            top: initialTop,
          }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <div className="bg-white/95 backdrop-blur-md p-3.5 sm:p-4 rounded-2xl shadow-2xl border border-indigo-100/80 w-[calc(100vw-2rem)] sm:w-[320px] max-w-[320px] pointer-events-auto flex flex-col">
            <div 
              className="flex items-center justify-between mb-3 cursor-grab active:cursor-grabbing touch-none px-1"
              onPointerDown={(e) => controls.start(e)}
            >
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50/80 text-indigo-600 rounded-full text-[9px] font-black uppercase tracking-wider border border-indigo-100/50">
                <Quote className="w-2.5 h-2.5" />
                <span>时空关系网络</span>
              </div>
              <button 
                onClick={() => setSelectedRelationship(null)}
                className="p-1 hover:bg-slate-100 rounded-full transition-colors text-slate-400 self-start"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <div className="flex flex-col gap-3 overflow-y-auto nice-scrollbar pr-1 -mr-1">
              <div className="flex items-start justify-between gap-3 shrink-0">
                <div className="flex flex-col items-center gap-1 w-14 shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-slate-50 overflow-hidden flex items-center justify-center text-slate-400 border border-slate-100 transition-all hover:bg-white hover:border-indigo-200 shadow-sm">
                    {selectedRelationship.source.image_url ? (
                      <img 
                        src={selectedRelationship.source.image_url} 
                        className="w-full h-full object-cover pointer-events-none" 
                        alt={selectedRelationship.source.name}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-slate-700 text-center leading-tight">{selectedRelationship.source.name}</span>
                </div>
                
                <div className="flex-1 flex flex-col items-center pt-3">
                  <div className="w-full h-[2px] bg-indigo-100 relative mb-2">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  </div>
                  <div className="text-[10px] font-bold text-indigo-600 text-center leading-relaxed break-words px-1">
                    {selectedRelationship.rel.relationship_type}
                  </div>
                </div>

                <div className="flex flex-col items-center gap-1 w-14 shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-slate-50 overflow-hidden flex items-center justify-center text-slate-400 border border-slate-100 transition-all hover:bg-white hover:border-indigo-200 shadow-sm">
                    {selectedRelationship.target.image_url ? (
                      <img 
                        src={selectedRelationship.target.image_url} 
                        className="w-full h-full object-cover pointer-events-none" 
                        alt={selectedRelationship.target.name}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-slate-700 text-center leading-tight">{selectedRelationship.target.name}</span>
                </div>
              </div>

              {!chatState ? (
                <button
                  onClick={handleStartChat}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors text-[11px] font-medium border border-indigo-100/50"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  开启跨时空对话
                </button>
              ) : (
                <div className="mt-2 p-3 bg-slate-50/50 rounded-xl border border-slate-100 text-xs text-slate-700">
                  {chatState.isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-[11px]">正在连线时空...</span>
                    </div>
                  ) : chatState.error ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-3 text-red-500">
                      <span className="text-[11px] text-center px-2">{chatState.error}</span>
                      <button 
                        onClick={() => setChatState(null)} 
                        className="text-[10px] underline hover:text-red-600"
                      >
                        返回
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 py-1">
                      {chatState.messages.map((msg, idx) => {
                        const isSource = msg.speaker === selectedRelationship.source.name;
                        return (
                          <div 
                            key={idx} 
                            className={`flex items-start gap-2 w-full ${isSource ? 'flex-row' : 'flex-row-reverse'} animate-in slide-in-from-bottom-1 fade-in duration-700`} 
                            style={{ 
                              animationDelay: `${idx * 1200}ms`, 
                              animationFillMode: 'both' 
                            }}
                          >
                            <div className="w-5 h-5 shrink-0 rounded-md overflow-hidden bg-slate-100 border border-slate-200 mt-1 shadow-sm">
                              <img 
                                src={isSource ? selectedRelationship.source.image_url : selectedRelationship.target.image_url} 
                                alt={msg.speaker} 
                                className="w-full h-full object-cover" 
                              />
                            </div>
                            <div className={`group relative p-2.5 rounded-2xl text-[11px] font-medium leading-relaxed max-w-[80%] shadow-sm border ${
                              isSource 
                                ? 'bg-indigo-600 border-indigo-500 text-white rounded-tl-none' 
                                : 'bg-white border-slate-100 text-slate-800 rounded-tr-none'
                            }`}>
                              {msg.text}
                              {/* Simple triangle arrow */}
                              <div className={`absolute top-0 w-2 h-2 ${
                                isSource 
                                  ? '-left-1 bg-indigo-600' 
                                  : '-right-1 bg-white border-t border-r border-slate-100'
                              } rotate-45 z-[-1]`} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Arrow */}
          <div className="w-4 h-4 bg-white border-r border-b border-indigo-100 absolute left-1/2 -translate-x-1/2 -bottom-2 rotate-45 shadow-[4px_4px_8px_rgba(0,0,0,0.02)]" />
        </motion.div>
      )}
    </div>
  );
}
