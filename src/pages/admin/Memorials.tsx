import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin, Navigation, X, Crosshair, ArrowLeft, Loader2 } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

interface OrderResult {
  id: string;
  deceased_name: string | null;
  status: string;
  offer: string;
  created_at: string;
  scheduled_date: string | null;
  shopper_name: string | null;
  shopper_email: string | null;
  monument_id: string;
  monuments?: { cemetery_name: string; cemetery_lat: number | null; cemetery_lng: number | null };
}

interface GroupedMemorial {
  key: string;
  deceasedName: string;
  cemeteryName: string;
  orders: OrderResult[];
  savedLocation: { id: string; latitude: number; longitude: number } | null;
}

interface MemorialLocation {
  id: string;
  deceased_first_name: string;
  deceased_last_name: string;
  cemetery_name: string;
  latitude: number;
  longitude: number;
  gps_accuracy_meters: number | null;
}

export default function Memorials() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupedMemorial[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMemorial, setSelectedMemorial] = useState<GroupedMemorial | null>(null);
  const [pinningMemorial, setPinningMemorial] = useState<GroupedMemorial | null>(null);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(() => searchOrders(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const searchOrders = async (q: string) => {
    setLoading(true);
    const { data: orders } = await supabase
      .from("orders")
      .select("id, deceased_name, status, offer, created_at, scheduled_date, shopper_name, shopper_email, monument_id")
      .ilike("deceased_name", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!orders?.length) { setResults([]); setLoading(false); return; }

    const monumentIds = [...new Set(orders.map(o => o.monument_id))];
    const { data: monuments } = await supabase
      .from("monuments")
      .select("id, cemetery_name, cemetery_lat, cemetery_lng")
      .in("id", monumentIds);

    const monumentMap = Object.fromEntries((monuments || []).map(m => [m.id, m]));

    // Get saved locations
    const deceasedNames = [...new Set(orders.map(o => o.deceased_name).filter(Boolean))];
    const { data: locations } = await supabase
      .from("memorial_locations")
      .select("*")
      .in("cemetery_name", [...new Set((monuments || []).map(m => m.cemetery_name))]);

    const locMap = new Map<string, MemorialLocation>();
    (locations || []).forEach((loc: any) => {
      const key = `${loc.deceased_first_name} ${loc.deceased_last_name}|${loc.cemetery_name}`.toLowerCase();
      locMap.set(key, loc);
    });

    // Group by deceased + cemetery
    const groups = new Map<string, GroupedMemorial>();
    for (const order of orders) {
      const monument = monumentMap[order.monument_id];
      const cemeteryName = monument?.cemetery_name || "Unknown";
      const deceasedName = order.deceased_name || "Unknown";
      const key = `${deceasedName}|${cemeteryName}`.toLowerCase();

      if (!groups.has(key)) {
        const locKey = key;
        const savedLoc = locMap.get(locKey);
        groups.set(key, {
          key,
          deceasedName,
          cemeteryName,
          orders: [],
          savedLocation: savedLoc ? { id: savedLoc.id, latitude: Number(savedLoc.latitude), longitude: Number(savedLoc.longitude) } : null,
        });
      }
      groups.get(key)!.orders.push({ ...order, monuments: monument });
    }

    setResults(Array.from(groups.values()));
    setLoading(false);
  };

  const handleNavigate = (lat: number, lng: number) => {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIos
      ? `maps://maps.apple.com/?daddr=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, "_blank");
  };

  const handleLocationSaved = (memorial: GroupedMemorial, locId: string, lat: number, lng: number) => {
    setResults(prev => prev.map(g =>
      g.key === memorial.key ? { ...g, savedLocation: { id: locId, latitude: lat, longitude: lng } } : g
    ));
    if (selectedMemorial?.key === memorial.key) {
      setSelectedMemorial(prev => prev ? { ...prev, savedLocation: { id: locId, latitude: lat, longitude: lng } } : null);
    }
    setPinningMemorial(null);
  };

  // Full-screen pin map
  if (pinningMemorial) {
    return (
      <PinLocationMap
        memorial={pinningMemorial}
        onSave={(locId, lat, lng) => handleLocationSaved(pinningMemorial, locId, lat, lng)}
        onCancel={() => setPinningMemorial(null)}
      />
    );
  }

  // Memorial detail view
  if (selectedMemorial) {
    return (
      <MemorialDetail
        memorial={selectedMemorial}
        onBack={() => setSelectedMemorial(null)}
        onPinLocation={() => setPinningMemorial(selectedMemorial)}
        onNavigate={handleNavigate}
      />
    );
  }

  // Search view
  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <h1 className="text-xl font-bold">Memorial Records</h1>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by deceased name…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-10"
          autoFocus
        />
        {query && (
          <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {loading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>}

      {!loading && query.length >= 2 && results.length === 0 && (
        <p className="text-center text-muted-foreground py-8 text-sm">No memorials found.</p>
      )}

      <div className="space-y-2">
        {results.map(group => (
          <Card key={group.key} className="p-3 cursor-pointer active:bg-muted/50" onClick={() => setSelectedMemorial(group)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">{group.deceasedName}</p>
                <p className="text-xs text-muted-foreground truncate">{group.cemeteryName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{group.orders.length} order{group.orders.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex-shrink-0">
                {group.savedLocation ? (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={e => { e.stopPropagation(); handleNavigate(group.savedLocation!.latitude, group.savedLocation!.longitude); }}>
                    <Navigation className="h-3 w-3" /> Navigate
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" className="h-8 text-xs gap-1" onClick={e => { e.stopPropagation(); setPinningMemorial(group); }}>
                    <MapPin className="h-3 w-3" /> Pin Location
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Memorial Detail View ---
function MemorialDetail({ memorial, onBack, onPinLocation, onNavigate }: {
  memorial: GroupedMemorial;
  onBack: () => void;
  onPinLocation: () => void;
  onNavigate: (lat: number, lng: number) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [heroPhoto, setHeroPhoto] = useState<string | null>(null);

  // Fetch the most recent "after" photo (from completed orders)
  useEffect(() => {
    const completedOrderIds = memorial.orders.filter(o => o.status === "completed").map(o => o.id);
    const monumentIds = [...new Set(memorial.orders.map(o => o.monument_id))];
    if (!monumentIds.length) return;

    const query = supabase
      .from("photo_records")
      .select("photo_url, order_id")
      .in("monument_id", monumentIds)
      .order("taken_at", { ascending: false })
      .limit(1);

    // Prefer photos linked to completed orders (after photos)
    if (completedOrderIds.length) {
      query.in("order_id", completedOrderIds);
    }

    query.then(({ data }) => {
      if (data?.[0]) setHeroPhoto(data[0].photo_url);
    });
  }, [memorial.orders]);

  useEffect(() => {
    if (!mapRef.current || !memorial.savedLocation) return;
    const { latitude, longitude } = memorial.savedLocation;
    const map = L.map(mapRef.current, { center: [latitude, longitude], zoom: 18, zoomControl: false, attributionControl: false });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }).addTo(map);
    L.marker([latitude, longitude]).addTo(map);
    return () => { map.remove(); };
  }, [memorial.savedLocation]);

  const statusColor = (s: string) => {
    if (s === "completed") return "default";
    if (s === "cancelled") return "destructive";
    return "secondary";
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div>
        <h1 className="text-xl font-bold">{memorial.deceasedName}</h1>
        <p className="text-sm text-muted-foreground">{memorial.cemeteryName}</p>
      </div>

      {memorial.savedLocation ? (
        <div className="space-y-2">
          <div ref={mapRef} className="h-48 rounded-lg overflow-hidden" />
          <Button className="w-full gap-2" onClick={() => onNavigate(memorial.savedLocation!.latitude, memorial.savedLocation!.longitude)}>
            <Navigation className="h-4 w-4" /> Navigate to Memorial
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="w-full gap-2" onClick={onPinLocation}>
          <MapPin className="h-4 w-4" /> Pin Location
        </Button>
      )}

      {/* Hero after photo */}
      {heroPhoto && (
        <div className="rounded-lg overflow-hidden">
          <img src={heroPhoto} alt={`${memorial.deceasedName} after cleaning`} className="w-full h-48 object-cover" loading="lazy" />
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Orders ({memorial.orders.length})</h2>
        {memorial.orders.map(order => (
          <Card key={order.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {new Date(order.created_at).toLocaleDateString()} • Offer {order.offer}
                </p>
                {order.scheduled_date && <p className="text-xs">Scheduled: {new Date(order.scheduled_date).toLocaleDateString()}</p>}
                {order.shopper_name && <p className="text-xs text-muted-foreground mt-1">Customer: {order.shopper_name}</p>}
              </div>
              <Badge variant={statusColor(order.status)} className="text-[10px] flex-shrink-0">{order.status}</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Full-Screen Pin Location Map ---
function PinLocationMap({ memorial, onSave, onCancel }: {
  memorial: GroupedMemorial;
  onSave: (locId: string, lat: number, lng: number) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const initialOrderRef = useRef(memorial.orders[0]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Use cemetery coords from first order if available, else default
    const firstOrder = initialOrderRef.current;
    const cemeteryLat = firstOrder?.monuments?.cemetery_lat;
    const cemeteryLng = firstOrder?.monuments?.cemetery_lng;
    const center: [number, number] = cemeteryLat && cemeteryLng
      ? [Number(cemeteryLat), Number(cemeteryLng)]
      : [37.0978, -89.5625];
    const zoom = cemeteryLat && cemeteryLng ? 18 : 8;

    const map = L.map(containerRef.current, { center, zoom, zoomControl: false });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri", maxZoom: 21,
    }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21 }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      placePin(map, lat, lng);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);

  const placePin = (map: L.Map, lat: number, lng: number) => {
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map);
      markerRef.current.on("dragend", () => {
        const pos = markerRef.current!.getLatLng();
        setCoords({ lat: pos.lat, lng: pos.lng });
      });
    }
    setCoords({ lat, lng });
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 19);
          placePin(mapRef.current, latitude, longitude);
        }
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleSave = async () => {
    if (!coords) return;
    setSaving(true);
    const nameParts = (memorial.deceasedName || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    if (memorial.savedLocation) {
      await supabase.from("memorial_locations").update({
        latitude: coords.lat, longitude: coords.lng,
      }).eq("id", memorial.savedLocation.id);
      onSave(memorial.savedLocation.id, coords.lat, coords.lng);
    } else {
      const { data } = await supabase.from("memorial_locations").insert({
        deceased_first_name: firstName,
        deceased_last_name: lastName,
        cemetery_name: memorial.cemeteryName,
        latitude: coords.lat,
        longitude: coords.lng,
      }).select("id").single();
      if (data) onSave(data.id, coords.lat, coords.lng);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b bg-background/95 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8">
          <X className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{memorial.deceasedName}</p>
          <p className="text-[10px] text-muted-foreground truncate">{memorial.cemeteryName}</p>
        </div>
      </div>

      {/* Map */}
      <div ref={containerRef} className="flex-1" />

      {/* Bottom controls */}
      <div className="p-3 border-t bg-background/95 backdrop-blur space-y-2">
        <Button variant="outline" className="w-full gap-2" onClick={handleUseMyLocation} disabled={locating}>
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
          Use My Current Location
        </Button>
        <Button className="w-full gap-2" disabled={!coords || saving} onClick={handleSave}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          Save Location
        </Button>
      </div>
    </div>
  );
}
