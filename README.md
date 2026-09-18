# sr-energy-api

## Storage buckets (Supabase)

Os buckets do Storage **não** são criados via migration/config declarativo
neste projeto (`supabase/config.toml` só tem um exemplo comentado) — a
criação é sempre manual, tanto no ambiente local (`supabase start`) quanto no
remoto (painel do Supabase). Todos os buckets abaixo são **privados**
(sem acesso público direto) — o backend sempre serve o arquivo via URL
assinada com TTL curto (`getSignedUrl`, ver `src/services/storage.service.ts`,
`SIGNED_BUCKETS`).

| Bucket | Usado por | Conteúdo |
|---|---|---|
| `contract-files` | `POST /contracts/:id/file` | PDF do contrato |
| `bag-certificates` | `bags.ts` | Certificados de calibração |
| `evidences` | `POST /reports/:id/evidences` | Evidências do relatório de OS (foto/PDF/vídeo/áudio) |
| `documents` | `documents.ts` | Documentos gerados/anexados |
| `employee-photos` | `POST /employees/:id/photo` | Foto de perfil do funcionário (sub-plano 02, épico ajustes-cliente-2026-09) |

### Criar o bucket `employee-photos`

1. **Local** (`supabase start` — requer Docker rodando): Studio local
   (`http://localhost:54323` por padrão) → Storage → New bucket →
   nome `employee-photos`, **Private bucket** marcado (sem "Public bucket").
2. **Remoto** (homologação): mesmo passo no painel do projeto no
   [supabase.com](https://supabase.com) → Storage → New bucket → mesmo nome,
   também privado.

Sem o bucket criado, `POST /employees/:id/photo` falha com erro de storage
("Bucket not found") — mesmo comportamento já conhecido para os demais
buckets privados quando ausentes (ver memória do projeto sobre o bucket
`documents`).

> Pendência desta sessão: o ambiente de desenvolvimento usado não tinha
> Docker disponível (`supabase status` falha), então o bucket não pôde ser
> criado nem localmente nem no remoto — só documentado aqui. Criação manual
> fica para quando o ambiente tiver Docker/acesso ao projeto remoto.
