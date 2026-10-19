#!/usr/bin/env bash
# Batería de pruebas HTTP contra una instancia de la API (local o desplegada).
# Uso:  scripts/smoke.sh                      → contra la API pública
#       scripts/smoke.sh http://localhost:3000 → contra una instancia local
set -u
B="${1:-https://disruption-companion.disruption-companion.workers.dev}"
K="smoke-$(date +%s)"
J='content-type: application/json'
T=$(mktemp)
fallas=0
chk() { if [ "$2" = "$3" ]; then printf "OK     %-52s %s\n" "$1" "$3"; else printf "FALLA  %-52s esperado %s, obtenido %s\n" "$1" "$2" "$3"; fallas=$((fallas+1)); fi; }
c() { curl -s -o "$T" -w "%{http_code}" "$@"; }
py() { python3 -c "import json,sys; d=json.load(open('$T')); $1" 2>&1 || { echo "FALLA  (contenido) $1"; fallas=$((fallas+1)); }; }

echo "API: $B"
chk "GET /health" 200 "$(c "$B/health")"
chk "GET /ruta-inexistente" 404 "$(c "$B/nada")"

chk "POST assessment ABC123 (caso base)" 200 "$(c -X POST "$B/bookings/ABC123/assessment")"
py "v=d['passenger_view']; a=d['assessment']
assert v['status']=='DISRUPTED' and v['recommendation']['flight_number']=='LA2412', 'recomendación'
assert [r['rule_id'] for r in a['policy']['applied']]==['R3','R5'], 'reglas'
assert a['decision']['automatic'] and a['human_case']['queue']=='DISRUPTION_L2', 'automática + caso humano'
assert a['events']['discarded'][0]['reason']=='SOURCE_DEGRADED', 'fuente degradada'
s=json.dumps(v); assert all(x not in s for x in ['OPS_CORE','LEGACY','12.345.678-9','María','maria.silva','+56']), 'fuga de datos'
print('       R3+R5, O1 automática, degradada descartada, caso humano, sin datos internos ni personales')"

chk "POST assessment con compensation_requested" 200 "$(c -X POST "$B/bookings/ABC123/assessment" -H "$J" -d '{"compensation_requested":true}')"
py "a=d['assessment']; assert any(r.get('rule_id')=='R4' for r in a['handoff']['reasons']); print('       R4 en derivación; O1 igual se recomienda')"

chk "POST assessment con opciones expiradas" 200 "$(c -X POST "$B/bookings/ABC123/assessment" -H "$J" -d '{"now":"2026-09-15T12:00:00Z"}')"
py "a=d['assessment']; assert a['decision']['recommendation'] is None and a['handoff']['required']; print('       sin recomendación, derivado a humano')"

chk "POST assessment reserva inexistente" 404 "$(c -X POST "$B/bookings/NOPE/assessment")"
chk "POST assessment JSON inválido" 400 "$(c -X POST "$B/bookings/ABC123/assessment" -H "$J" -d '{nope')"
chk "POST rebooking sin idempotency_key" 400 "$(c -X POST "$B/bookings/ABC123/rebooking" -H "$J" -d '{"option_id":"O1"}')"
chk "POST rebooking O2 (1 asiento para 2 pax)" 422 "$(c -X POST "$B/bookings/ABC123/rebooking" -H "$J" -d "{\"option_id\":\"O2\",\"idempotency_key\":\"$K-o2\"}")"
chk "POST rebooking O3 (no reembolsable)" 422 "$(c -X POST "$B/bookings/ABC123/rebooking" -H "$J" -d "{\"option_id\":\"O3\",\"idempotency_key\":\"$K-o3\"}")"
chk "POST rebooking O1 primera vez" 201 "$(c -X POST "$B/bookings/ABC123/rebooking" -H "$J" -d "{\"option_id\":\"O1\",\"idempotency_key\":\"$K-o1\"}")"
R1=$(python3 -c "import json; print(json.load(open('$T'))['request_id'])")
chk "POST rebooking O1 misma clave (409 → ya solicitado)" 200 "$(c -X POST "$B/bookings/ABC123/rebooking" -H "$J" -d "{\"option_id\":\"O1\",\"idempotency_key\":\"$K-o1\"}")"
R2=$(python3 -c "import json; print(json.load(open('$T'))['request_id'])")
chk "mismo request_id en el reintento" "$R1" "$R2"
chk "POST rebooking con timeout simulado (503 → 202)" 202 "$(c -X POST "$B/bookings/ABC123/rebooking" -H "$J" -d "{\"option_id\":\"O1\",\"idempotency_key\":\"$K-timeout\"}")"
py "assert d['status']=='INDETERMINATE' and d['case_id'].startswith('HC-'); print('       caso humano abierto, sin reintento')"
chk "POST rebooking reserva inexistente" 404 "$(c -X POST "$B/bookings/NOPE/rebooking" -H "$J" -d '{"option_id":"O1","idempotency_key":"12345678"}')"

rm -f "$T"
echo
if [ "$fallas" -eq 0 ]; then echo "Todo OK"; else echo "$fallas falla(s)"; exit 1; fi
