# Dados GeoJSON

Coloque aqui seus arquivos `.geojson` e importe com:

```bash
npm run import -- --dir data/ --truncate
```

A camada é detectada pelo **nome do arquivo** (ou informe `--layer`):

| Nome do arquivo contém | Camada        |
|------------------------|---------------|
| `bairro`               | `bairros`     |
| `quadra`               | `quadras`     |
| `lote` / `parcela`     | `lotes`       |
| `rua` / `via` / `eixo` | `ruas`        |
| `edific` / `constru`   | `edificacoes` |

> Os arquivos `.geojson`/`.json` aqui são ignorados pelo Git (veja `.gitignore`).

## Propriedades reconhecidas (mapeamento automático)

O importador procura estas chaves (sem diferenciar maiúsculas/minúsculas) e
guarda **todas** as propriedades originais no campo `props`:

- **bairros**: `nome`/`name`, `populacao`/`habitantes`, `area`
- **quadras**: `codigo`/`quadra`, `bairro`, `area`
- **lotes**: `codigo`/`inscricao`, `quadra`, `bairro`, `uso`, `area`
- **ruas**: `nome`/`logradouro`, `bairro`, `pavimentada`/`pavimento`, `tipo_pavimento`, `extensao`
- **edificacoes**: `codigo`, `uso`, `bairro`, `n_pavimentos`/`andares`, `area`

`pavimentada` aceita `sim/não`, `true/false`, `1/0` ou um tipo de pavimento
(`asfalto`, `bloquete`, `terra`, `leito natural`, ...). Área e extensão são
calculadas automaticamente (em metros) quando não vierem no arquivo.
