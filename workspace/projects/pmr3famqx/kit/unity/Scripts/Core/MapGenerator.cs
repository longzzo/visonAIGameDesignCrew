using UnityEngine;

public class MapGenerator : MonoBehaviour
{
    public int mapSizeX = 12;
    public int mapSizeY = 12;
    public float obstacleSpawnChance = 0.2f;
    public float itemSpawnChance = 0.15f;
    public float bossSpawnChance = 0.1f;

    public event System.Action<Vector2[]> OnMapGenerated;

    private void Start() => GenerateMap();

    public void GenerateMap()
    {
        // TODO: CSV 로드 (MapProbabilities.csv) → 랜덤 셀 배치 → OnMapGenerated 발행
    }

    public bool IsValidPosition(Vector2 position)
    {
        // TODO: 맵 경계 및 중복 체크
        return true;
    }
}
