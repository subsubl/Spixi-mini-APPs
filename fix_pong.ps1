$file = "d:\Spixi-Mini-APPs\Spixi-mini-APPs-1\apps\com.baracuda.spixi.pong\app\js\pong.js"
$content = Get-Content -Path $file -Raw
$search = "    } catch (e) {
        console.error(""Error in game loop:"", e);
        // Don't stop the loop, try to recover next frame
        if (!gameLoopId && !gameState.gameEnded) {
            gameLoopId = requestAnimationFrame(gameLoop);
        }
    }"
$replace = "    } catch (e) {
        console.error(""Error in game loop:"", e);
        // Force restart the loop even if ID exists (it might be stale/broken)
        if (!gameState.gameEnded) {
             if (gameLoopId) cancelAnimationFrame(gameLoopId);
             gameLoopId = requestAnimationFrame(gameLoop);
        }
    }"

# Normalize line endings to avoid mismatch
$content = $content -replace "`r`n", "`n"
$search = $search -replace "`r`n", "`n"
$replace = $replace -replace "`r`n", "`n"

if ($content.Contains($search)) {
    $newContent = $content.Replace($search, $replace)
    Set-Content -Path $file -Value $newContent -NoNewline
    Write-Host "Replacement successful"
} else {
    Write-Host "Search string not found"
    exit 1
}
