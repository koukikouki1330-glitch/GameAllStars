using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

// Public-hosting friendly binding. Most cloud hosts provide PORT automatically.
var bindUrl = Environment.GetEnvironmentVariable("GAMEALLSTARS_BIND_URL");
if (string.IsNullOrWhiteSpace(bindUrl))
{
    var port = Environment.GetEnvironmentVariable("PORT");
    bindUrl = string.IsNullOrWhiteSpace(port) ? "http://localhost:5180" : $"http://0.0.0.0:{port}";
}
builder.WebHost.UseUrls(bindUrl);

// CORS is disabled by default only in the sense that no credentials are used;
// configure GAMEALLSTARS_CORS_ORIGINS for the deployed site origin(s).
var corsOrigins = (Environment.GetEnvironmentVariable("GAMEALLSTARS_CORS_ORIGINS") ?? "")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
if (corsOrigins.Length > 0)
{
    builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod();
    }));
}

var app = builder.Build();
if (corsOrigins.Length > 0) app.UseCors();

var root = app.Environment.ContentRootPath;
var dataDir = Path.Combine(root, "data");
var gamesDir = Path.Combine(dataDir, "games");
Directory.CreateDirectory(gamesDir);

var publicBaseUrl = (Environment.GetEnvironmentVariable("GAMEALLSTARS_PUBLIC_BASE_URL") ?? "").TrimEnd('/');
var ownershipPath = Path.Combine(dataDir, "ownership.json");
var manifestPath = Path.Combine(dataDir, "manifest.json");

app.MapGet("/", () => Results.Json(new
{
    name = "Game All-stars Store Server",
    status = "ok",
    manifest = "/manifest.json",
    api = new[] { "/api/library", "/api/purchase", "/api/publish" }
}));
app.MapGet("/health", () => Results.Json(new { status = "ok" }));
app.MapGet("/manifest.json", async () =>
{
    if (!File.Exists(manifestPath))
    {
        var empty = new StoreManifest();
        return Results.Json(empty);
    }
    return Results.Text(await File.ReadAllTextAsync(manifestPath), "application/json");
});

app.MapGet("/games/{gameId}/{version}.zip", (string gameId, string version) =>
{
    if (!SafePart(gameId) || !SafePart(version)) return Results.BadRequest();
    var path = Path.Combine(gamesDir, gameId, version + ".zip");
    return File.Exists(path) ? Results.File(path, "application/zip", enableRangeProcessing: true) : Results.NotFound();
});

app.MapGet("/api/library", async (HttpRequest request) =>
{
    var guestId = request.Query["guestId"].ToString();
    if (string.IsNullOrWhiteSpace(guestId)) return Results.BadRequest("guestId is required.");
    var ownership = await LoadOwnershipAsync(ownershipPath);
    var owned = ownership
        .Where(x => x.GuestId.Equals(guestId, StringComparison.OrdinalIgnoreCase))
        .Select(x => x.GameId)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();
    return Results.Json(new { guestId, games = owned });
});

app.MapPost("/api/purchase", async (PurchaseRequest req) =>
{
    if (string.IsNullOrWhiteSpace(req.GuestId)) return Results.BadRequest("guestId is required.");
    if (!SafePart(req.GameId)) return Results.BadRequest("Invalid gameId.");
    var manifest = File.Exists(manifestPath)
        ? (JsonSerializer.Deserialize<StoreManifest>(await File.ReadAllTextAsync(manifestPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new())
        : new();
    var game = manifest.Games.FirstOrDefault(x => x.Id.Equals(req.GameId, StringComparison.OrdinalIgnoreCase));
    if (game is null) return Results.NotFound("そのゲームはストアにありません。");
    if (!game.Price.Equals("FREE", StringComparison.OrdinalIgnoreCase))
        return Results.StatusCode(StatusCodes.Status402PaymentRequired);
    var ownership = await LoadOwnershipAsync(ownershipPath);
    var alreadyOwned = ownership.Any(x => x.GuestId.Equals(req.GuestId, StringComparison.OrdinalIgnoreCase) && x.GameId.Equals(game.Id, StringComparison.OrdinalIgnoreCase));
    if (!alreadyOwned)
    {
        ownership.Add(new OwnershipRecord { GuestId = req.GuestId.Trim(), GameId = game.Id, PurchasedUtc = DateTimeOffset.UtcNow });
        await SaveJsonAsync(ownershipPath, ownership);
    }
    return Results.Json(new { purchased = true, alreadyOwned, gameId = game.Id, title = game.Title, price = game.Price });
});

app.MapPost("/api/publish", async (HttpRequest request) =>
{
    if (!request.HasFormContentType) return Results.BadRequest("multipart/form-data is required.");
    var form = await request.ReadFormAsync();
    var guestId = form["guestId"].ToString();
    var gameId = form["gameId"].ToString();
    var title = form["title"].ToString();
    var description = form["description"].ToString();
    var version = form["version"].ToString();
    var price = string.IsNullOrWhiteSpace(form["price"]) ? "FREE" : form["price"].ToString();
    var genre = form["genre"].ToString();
    var sha256 = form["sha256"].ToString();
    var package = form.Files.GetFile("package");

    if (string.IsNullOrWhiteSpace(guestId) || !SafePart(gameId) || !SafePart(version) || string.IsNullOrWhiteSpace(title) || package is null)
        return Results.BadRequest("gameId, title, version and package are required.");
    if (package!.Length > 2L * 1024 * 1024 * 1024) return Results.BadRequest("Package is too large.");

    var gameDir = Path.Combine(gamesDir, gameId);
    Directory.CreateDirectory(gameDir);
    var zipPath = Path.Combine(gameDir, version + ".zip");
    await using (var output = File.Create(zipPath)) await package!.CopyToAsync(output);
    var actualSha = await ComputeSha256Async(zipPath);
    if (!string.Equals(actualSha, sha256, StringComparison.OrdinalIgnoreCase)) { File.Delete(zipPath); return Results.BadRequest("SHA-256 mismatch."); }

    StoreManifest manifest = File.Exists(manifestPath)
        ? (JsonSerializer.Deserialize<StoreManifest>(await File.ReadAllTextAsync(manifestPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new())
        : new();
    manifest.Games.RemoveAll(x => x.Id.Equals(gameId, StringComparison.OrdinalIgnoreCase));
    var baseUrl = string.IsNullOrWhiteSpace(publicBaseUrl) ? $"{request.Scheme}://{request.Host}" : publicBaseUrl;
    var downloadUrl = $"{baseUrl}/games/{Uri.EscapeDataString(gameId)}/{Uri.EscapeDataString(version)}.zip";
    manifest.Games.Add(new StoreGame { Id = gameId, Title = title, Description = description, Version = version, Price = price, Genre = genre, DownloadUrl = downloadUrl, Sha256 = actualSha, SizeBytes = new FileInfo(zipPath).Length });
    await SaveJsonAsync(manifestPath, manifest);

    return Results.Json(new { manifestUrl = $"{baseUrl}/manifest.json", downloadUrl, gameId, version, sha256 = actualSha, publisher = "guest" });
});

app.Run();

static bool SafePart(string value)
{
    if (string.IsNullOrWhiteSpace(value)) return false;
    if (value is "." or "..") return false;
    if (value.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return false;
    return !value.Contains('/') && !value.Contains('\\');
}

static async Task<List<OwnershipRecord>> LoadOwnershipAsync(string path) => await LoadJsonAsync<List<OwnershipRecord>>(path) ?? new();
static async Task<T?> LoadJsonAsync<T>(string path) { if (!File.Exists(path)) return default; try { return JsonSerializer.Deserialize<T>(await File.ReadAllTextAsync(path)); } catch { return default; } }
static async Task SaveJsonAsync<T>(string path, T value) { Directory.CreateDirectory(Path.GetDirectoryName(path)!); await File.WriteAllTextAsync(path, JsonSerializer.Serialize(value, new JsonSerializerOptions { WriteIndented = true })); }
static async Task<string> ComputeSha256Async(string path) { await using var stream = File.OpenRead(path); return Convert.ToHexString(await SHA256.HashDataAsync(stream)); }

public sealed class OwnershipRecord { public string GuestId { get; set; } = ""; public string GameId { get; set; } = ""; public DateTimeOffset PurchasedUtc { get; set; } }
public sealed class PurchaseRequest { public string GameId { get; set; } = ""; public string GuestId { get; set; } = ""; }
public sealed class StoreManifest { public int SchemaVersion { get; set; } = 1; public string StoreName { get; set; } = "Game All-stars Store"; public List<StoreGame> Games { get; set; } = new(); }
public sealed class StoreGame { public string Id { get; set; } = ""; public string Title { get; set; } = ""; public string Description { get; set; } = ""; public string Version { get; set; } = "1.0.0"; public string Price { get; set; } = "FREE"; public string Genre { get; set; } = ""; public string DownloadUrl { get; set; } = ""; public string Sha256 { get; set; } = ""; public long SizeBytes { get; set; } public string Publisher { get; set; } = ""; }
